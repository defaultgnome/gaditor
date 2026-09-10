import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  ActionNode,
  IngredientNode,
  Recipe,
  RecipeNode,
  SplitNode,
  WaitNode,
} from '../model/types'
import type { Translate } from '../i18n'
import { wouldCycle } from '../solver/layout'
import { layerColumns } from '../solver/columns'
import { streamLabel } from '../solver/labels'
import { useApp } from '../store/app'

type Props = {
  recipe: Recipe
  selected: string | null
  onSelect: (id: string | null) => void
  onConnectNodes: (from: string, to: string) => void
  onDisconnect: (from: string, to: string) => void
  onDeleteNodes: (ids: string[]) => void
  onPatchNode: (id: string, patch: Partial<RecipeNode>) => void
  onCycleBlocked: () => void
}

/**
 * §6.2 — the node body edits the recipe in place (Blender-style inline config), so the
 * nodes need both the live recipe node and write access to it. Both travel by context
 * rather than through React Flow's `data`:
 *
 *  - `data` is a snapshot React Flow only picks up on the *next* commit, so a field fed
 *    from it renders one keystroke behind, and React then rewrites the input with the
 *    stale value — which throws the caret to the end of the box on every character.
 *  - a context update reaches the node in the same commit as the edit that caused it,
 *    and leaves React Flow's own node objects untouched, so nothing else re-renders.
 */
type NodeApi = {
  nodes: Map<string, RecipeNode>
  patch: (id: string, patch: Partial<RecipeNode>) => void
  remove: (id: string) => void
}
const NodeApiContext = createContext<NodeApi>({
  nodes: new Map(),
  patch: () => {},
  remove: () => {},
})

/** Rough rendered height, used only to stack freshly added nodes without overlap. */
function estimateHeight(n: RecipeNode): number {
  switch (n.type) {
    case 'ingredient':
      return 186
    case 'action':
      return 96
    case 'wait':
      return 136
    case 'split':
      return 112 + n.portions.length * 34
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="nf-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function FlowNode({ id, selected }: NodeProps) {
  const api = useContext(NodeApiContext)
  const { t } = useApp()
  const node = api.nodes.get(id)
  if (!node) return null
  const set = (patch: Partial<RecipeNode>) => api.patch(id, patch)

  return (
    <div className={`flow-node k-${node.type}${selected ? ' selected' : ''}`}>
      {/* An ingredient is a source: it takes no inputs, so it grows no input socket. */}
      {node.type !== 'ingredient' && <Handle type="target" position={Position.Left} />}
      <div className="nf-head">
        <span className="type">
          {t(`editor.add${node.type[0].toUpperCase()}${node.type.slice(1)}`)}
        </span>
        <button
          className="nf-x nodrag"
          aria-label={t('editor.deleteNode')}
          title={t('editor.deleteNode')}
          onClick={() => api.remove(id)}
        >
          ×
        </button>
      </div>

      <div className="nf-body">
        {node.type === 'ingredient' && <IngredientFields node={node} set={set} t={t} />}
        {node.type === 'action' && <ActionFields node={node} set={set} t={t} />}
        {node.type === 'wait' && <WaitFields node={node} set={set} t={t} />}
        {node.type === 'split' && <SplitFields node={node} set={set} t={t} />}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

type FieldProps<T extends RecipeNode> = {
  node: T
  set: (patch: Partial<RecipeNode>) => void
  t: Translate
}

function IngredientFields({ node, set, t }: FieldProps<IngredientNode>) {
  return (
    <>
      <Field label={t('editor.name')}>
        <input
          className="nodrag"
          type="text"
          value={node.name}
          onChange={(e) => set({ name: e.target.value } as Partial<RecipeNode>)}
        />
      </Field>
      <div className="nf-row">
        <Field label={t('editor.qty')}>
          <input
            className="nodrag"
            type="number"
            step="any"
            value={node.qty ?? ''}
            onChange={(e) =>
              set({
                qty: e.target.value === '' ? undefined : Number(e.target.value),
              } as Partial<RecipeNode>)
            }
          />
        </Field>
        <Field label={t('editor.unit')}>
          <input
            className="nodrag"
            type="text"
            value={node.unit ?? ''}
            onChange={(e) => set({ unit: e.target.value } as Partial<RecipeNode>)}
          />
        </Field>
      </div>
      <Field label={t('editor.ref')}>
        <input
          className="nodrag"
          type="text"
          value={node.ref ?? ''}
          onChange={(e) => set({ ref: e.target.value || undefined } as Partial<RecipeNode>)}
        />
      </Field>
    </>
  )
}

function ActionFields({ node, set, t }: FieldProps<ActionNode>) {
  return (
    <Field label={t('editor.label')}>
      <input
        className="nodrag"
        type="text"
        value={node.label}
        onChange={(e) => set({ label: e.target.value } as Partial<RecipeNode>)}
      />
    </Field>
  )
}

function WaitFields({ node, set, t }: FieldProps<WaitNode>) {
  return (
    <>
      <Field label={t('editor.label')}>
        <input
          className="nodrag"
          type="text"
          value={node.label}
          onChange={(e) => set({ label: e.target.value } as Partial<RecipeNode>)}
        />
      </Field>
      <Field label={t('editor.minutes')}>
        <input
          className="nodrag"
          type="number"
          min={0}
          value={node.minutes}
          onChange={(e) =>
            set({ minutes: Math.max(0, Number(e.target.value) || 0) } as Partial<RecipeNode>)
          }
        />
      </Field>
    </>
  )
}

function SplitFields({ node, set, t }: FieldProps<SplitNode>) {
  const patchPortion = (i: number, patch: Partial<SplitNode['portions'][number]>) =>
    set({
      portions: node.portions.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    } as Partial<RecipeNode>)

  return (
    <>
      <span className="nf-hint">{t('editor.portions')}</span>
      {node.portions.map((p, i) => (
        <div className="nf-portion" key={i}>
          <input
            className="nodrag nf-pct"
            type="number"
            min={0}
            max={100}
            aria-label={t('editor.portions')}
            value={p.percent}
            onChange={(e) => patchPortion(i, { percent: Number(e.target.value) || 0 })}
          />
          {i === 0 ? (
            // Portion 0 continues on the row the split already sits on, so it never
            // gets a marker of its own — there is nothing to name.
            <span className="nf-hint grow">{t('editor.portionStays')}</span>
          ) : (
            <input
              className="nodrag grow"
              type="text"
              aria-label={t('editor.rowName')}
              /* The solver falls back to A, B, C… — showing that as the placeholder
                 makes an empty box read as "auto", not as "unnamed". */
              placeholder={streamLabel(i - 1)}
              value={p.label}
              onChange={(e) => patchPortion(i, { label: e.target.value })}
            />
          )}
          {node.portions.length > 2 && (
            <button
              className="btn small ghost nodrag"
              aria-label={t('editor.removePortion')}
              onClick={() =>
                set({
                  portions: node.portions.filter((_, j) => j !== i),
                } as Partial<RecipeNode>)
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        className="btn small nodrag"
        style={{ marginTop: 6 }}
        onClick={() =>
          set({
            portions: [...node.portions, { percent: 0, label: '' }],
          } as Partial<RecipeNode>)
        }
      >
        {t('editor.addPortion')}
      </button>
    </>
  )
}

const nodeTypes: NodeTypes = { recipeNode: FlowNode }

/**
 * §6.2 — the node canvas. Positions are derived from the solver's layering and kept in
 * component state only: column position is not authorable (§3.1), so persisting a
 * hand-dragged x would be a lie the renderer ignores.
 */
export function GraphCanvas({
  recipe,
  selected,
  onSelect,
  onConnectNodes,
  onDisconnect,
  onDeleteNodes,
  onPatchNode,
  onCycleBlocked,
}: Props) {
  const positions = useRef(new Map<string, { x: number; y: number }>())
  // React Flow owns node positions while a drag is in flight, and it can only do that
  // if it gets its changes back. Without this state (and the onNodesChange feeding it)
  // a drag lands only on mouse-up, which reads as "the node never moves".
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])

  const layout = useMemo(() => layerColumns(recipe.nodes), [recipe.nodes])

  const api = useMemo<NodeApi>(
    () => ({
      nodes: new Map(recipe.nodes.map((n) => [n.id, n])),
      patch: onPatchNode,
      remove: (id) => onDeleteNodes([id]),
    }),
    [recipe.nodes, onPatchNode, onDeleteNodes],
  )

  // Mirror the recipe into React Flow's node list. Only membership and selection live
  // here — the node's contents come from the context — so this list churns when nodes
  // are added, removed or selected and at no other time. Positions of existing nodes
  // are carried over so an edit elsewhere never yanks a node back to its
  // solver-derived slot.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      const columnBottom = new Map<number, number>()
      const next = recipe.nodes.map((n) => {
        const existing = prevById.get(n.id)
        let pos = existing?.position ?? positions.current.get(n.id)
        if (!pos) {
          const col = layout.get(n.id) ?? 0
          const y = columnBottom.get(col) ?? 0
          columnBottom.set(col, y + estimateHeight(n) + 26)
          pos = { x: col * 290, y }
        }
        positions.current.set(n.id, pos)
        const isSelected = n.id === selected
        if (existing && existing.selected === isSelected) return existing
        return {
          ...existing,
          id: n.id,
          type: 'recipeNode',
          position: pos,
          data: {},
          selected: isSelected,
        } as Node
      })
      const live = new Set(recipe.nodes.map((n) => n.id))
      for (const id of [...positions.current.keys()]) {
        if (!live.has(id)) positions.current.delete(id)
      }
      const unchanged = next.length === prev.length && next.every((n, i) => n === prev[i])
      return unchanged ? prev : next
    })
  }, [recipe.nodes, layout, selected, setNodes])

  const edges: Edge[] = useMemo(
    () =>
      recipe.nodes.flatMap((n) =>
        n.inputs.map((input) => ({
          id: `${input}->${n.id}`,
          source: input,
          target: n.id,
          animated: false,
        })),
      ),
    [recipe.nodes],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      // §3.4 — cycles are hard-blocked at connect time. A cycle makes layering impossible.
      if (wouldCycle(recipe.nodes, c.source, c.target)) {
        onCycleBlocked()
        return
      }
      onConnectNodes(c.source, c.target)
    },
    [recipe.nodes, onConnectNodes, onCycleBlocked],
  )

  return (
    <div className="canvas-wrap">
      <NodeApiContext.Provider value={api}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => onSelect(n.id)}
          onPaneClick={() => onSelect(null)}
          onNodeDragStop={(_, n) => positions.current.set(n.id, n.position)}
          onNodesDelete={(deleted) => onDeleteNodes(deleted.map((n) => n.id))}
          onEdgesDelete={(deleted) => {
            for (const e of deleted) onDisconnect(e.source, e.target)
          }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </NodeApiContext.Provider>
    </div>
  )
}
