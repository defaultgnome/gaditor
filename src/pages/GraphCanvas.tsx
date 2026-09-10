import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type FinalConnectionState,
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
  onDuplicateNode: (id: string) => string | null
  /** Spawns a `mix` action wired to `nodeId`, and returns its id. */
  onSpawnConnected: (nodeId: string, direction: Direction) => string | null
  onPatchNode: (id: string, patch: Partial<RecipeNode>) => void
  onCycleBlocked: () => void
}

/** Which side of the existing node a spawned node lands on. */
export type Direction = 'downstream' | 'upstream'

/** A second tap on an edge within this window deletes it (§6.2). */
const DOUBLE_TAP_MS = 400

/** Connections snap to a socket this far away — the 6px dot alone is unhittable on a phone. */
const CONNECTION_RADIUS = 45

/** Widened invisible band around an edge, so tapping a 1px line actually lands. */
const EDGE_INTERACTION_WIDTH = 28

/** Matches `.flow-node` in styles.css, and the vertical centre of its input socket. */
const NODE_WIDTH = 228
const SPAWN_SOCKET_OFFSET = 26

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
  duplicate: (id: string) => void
}
const NodeApiContext = createContext<NodeApi>({
  nodes: new Map(),
  patch: () => {},
  remove: () => {},
  duplicate: () => {},
})

/** Rough rendered height, used only to stack freshly added nodes without overlap. */
function estimateHeight(n: RecipeNode): number {
  switch (n.type) {
    case 'ingredient':
      return 232
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
      {node.type !== 'ingredient' && (
        <>
          {/*
           * Landing a connection on the socket dot is finicky, so the whole node body is
           * a second target handle. It only takes pointer events while a connection is in
           * flight (see `.connecting` in styles.css) — permanently on, it would swallow
           * every click meant for the fields underneath it.
           */}
          <Handle
            type="target"
            id="body"
            position={Position.Left}
            className="handle-body"
            isConnectableStart={false}
          />
          <Handle type="target" position={Position.Left} />
        </>
      )}
      <div className="nf-head">
        <span className="type">
          {t(`editor.add${node.type[0].toUpperCase()}${node.type.slice(1)}`)}
        </span>
        {/*
         * The click must stop here. React Flow's `onNodeClick` sits on the node
         * wrapper, so a bubbling click selects *this* node right after the button
         * has selected the copy — the duplicate would be created and immediately
         * deselected again.
         */}
        <button
          className="nf-icon nodrag"
          aria-label={t('editor.duplicateNode')}
          title={t('editor.duplicateNode')}
          onClick={(e) => {
            e.stopPropagation()
            api.duplicate(id)
          }}
        >
          ⧉
        </button>
        <button
          className="nf-icon nf-x nodrag"
          aria-label={t('editor.deleteNode')}
          title={t('editor.deleteNode')}
          onClick={(e) => {
            e.stopPropagation()
            api.remove(id)
          }}
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
      {/* §2.2 — a second measure of the same amount, e.g. `1 packet / 10 g`. */}
      <div className="nf-row">
        <Field label={t('editor.altQty')}>
          <input
            className="nodrag"
            type="number"
            step="any"
            value={node.altQty ?? ''}
            onChange={(e) =>
              set({
                altQty: e.target.value === '' ? undefined : Number(e.target.value),
              } as Partial<RecipeNode>)
            }
          />
        </Field>
        <Field label={t('editor.altUnit')}>
          <input
            className="nodrag"
            type="text"
            value={node.altUnit ?? ''}
            onChange={(e) =>
              set({ altUnit: e.target.value || undefined } as Partial<RecipeNode>)
            }
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
 *
 * The provider is ours rather than React Flow's implicit one: {@link Canvas} needs
 * `screenToFlowPosition` (to place a node where a connection was dropped) and the live
 * connection state, and both of those only exist inside a provider.
 */
export function GraphCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({
  recipe,
  selected,
  onSelect,
  onConnectNodes,
  onDisconnect,
  onDeleteNodes,
  onDuplicateNode,
  onSpawnConnected,
  onPatchNode,
  onCycleBlocked,
}: Props) {
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const wrap = useRef<HTMLDivElement>(null)
  /** Flow coordinates of the last thing the author touched — where the next node lands. */
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  /** False until the first mirror pass has laid the stored graph out by column. */
  const hydrated = useRef(false)
  // React Flow owns node positions while a drag is in flight, and it can only do that
  // if it gets its changes back. Without this state (and the onNodesChange feeding it)
  // a drag lands only on mouse-up, which reads as "the node never moves".
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const { screenToFlowPosition } = useReactFlow()
  // A boolean, so this re-renders when a connection starts and when it ends, and not on
  // every pointer move in between.
  const connecting = useStore((s) => !!s.connection.fromHandle)

  const layout = useMemo(() => layerColumns(recipe.nodes), [recipe.nodes])

  /** Park a not-yet-rendered node at a chosen spot, ahead of the effect that places it. */
  const seedPosition = useCallback((id: string | null, x: number, y: number) => {
    lastPoint.current = { x, y }
    if (id) positions.current.set(id, { x, y })
  }, [])

  /**
   * Where a node added from the toolbar appears: the last place the author touched,
   * or the middle of what they are looking at if they have touched nothing yet.
   * Dropping every new node on the graph's origin means panning off to hunt for it.
   */
  const spawnPoint = useCallback(() => {
    if (lastPoint.current) return lastPoint.current
    const box = wrap.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return screenToFlowPosition({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    })
  }, [screenToFlowPosition])

  const api = useMemo<NodeApi>(
    () => ({
      nodes: new Map(recipe.nodes.map((n) => [n.id, n])),
      patch: onPatchNode,
      remove: (id) => onDeleteNodes([id]),
      duplicate: (id) => {
        // Offset from the original: a copy stacked exactly on top reads as nothing
        // having happened, and takes every later click meant for the node underneath.
        const from = positions.current.get(id) ?? { x: 0, y: 0 }
        seedPosition(onDuplicateNode(id), from.x + 38, from.y + 38)
      },
    }),
    [recipe.nodes, onPatchNode, onDeleteNodes, onDuplicateNode, seedPosition],
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
        if (!pos && !hydrated.current) {
          // First pass over a stored graph: lay the whole thing out by column.
          const col = layout.get(n.id) ?? 0
          const y = columnBottom.get(col) ?? 0
          columnBottom.set(col, y + estimateHeight(n) + 26)
          pos = { x: col * 290, y }
        }
        // A node added once the graph is on screen goes where the author last was,
        // nudged clear of whatever is already sitting there.
        if (!pos) pos = freeSpot(positions.current.values(), spawnPoint())
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
    hydrated.current = true
  }, [recipe.nodes, layout, selected, setNodes, spawnPoint])

  const edges: Edge[] = useMemo(
    () =>
      recipe.nodes.flatMap((n) =>
        n.inputs.map((input) => ({
          id: `${input}->${n.id}`,
          source: input,
          target: n.id,
          animated: false,
          interactionWidth: EDGE_INTERACTION_WIDTH,
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

  /**
   * Dropping a connection on empty canvas spawns the step it was heading for. Joining
   * streams is what a half-drawn connection almost always means, so that step is a
   * `mix` action, already wired and sitting where it was dropped.
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      // A connection that landed has already gone through onConnect.
      if (state.isValid) return
      const from = state.fromNode?.id
      if (!from) return
      const point = pointerPoint(event)
      if (!point) return
      // Dropped *onto* something that refused the connection — an ingredient takes no
      // inputs, a cycle was blocked, the controls were in the way. Spawning a node
      // under the cursor there would be a surprise, not a shortcut.
      const under = document.elementFromPoint(point.x, point.y)
      if (under?.closest('.react-flow__node, .react-flow__controls, .react-flow__panel')) return

      const direction: Direction =
        state.fromHandle?.type === 'target' ? 'upstream' : 'downstream'
      const at = screenToFlowPosition(point)
      // The socket the connection arrives at sits at the node's left edge; offset the
      // node's top-left corner so that socket, not the corner, lands under the drop.
      const x = direction === 'downstream' ? at.x : at.x - NODE_WIDTH
      seedPosition(onSpawnConnected(from, direction), x, at.y - SPAWN_SOCKET_OFFSET)
    },
    [screenToFlowPosition, onSpawnConnected, seedPosition],
  )

  /**
   * Double-tap an edge to delete it. Counted taps rather than the browser's `dblclick`:
   * `dblclick` is unreliable under touch, and on a phone this is the only way to undo a
   * connection — there is no Delete key.
   */
  const lastEdgeTap = useRef<{ id: string; at: number } | null>(null)
  const onEdgeClick = useCallback(
    (_: ReactMouseEvent, edge: Edge) => {
      const now = Date.now()
      const previous = lastEdgeTap.current
      if (previous && previous.id === edge.id && now - previous.at < DOUBLE_TAP_MS) {
        lastEdgeTap.current = null
        onDisconnect(edge.source, edge.target)
        return
      }
      lastEdgeTap.current = { id: edge.id, at: now }
    },
    [onDisconnect],
  )

  return (
    <div className={`canvas-wrap${connecting ? ' connecting' : ''}`} ref={wrap}>
      <NodeApiContext.Provider value={api}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          connectionRadius={CONNECTION_RADIUS}
          proOptions={{ hideAttribution: true }}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeClick={(_, n) => {
            lastPoint.current = n.position
            onSelect(n.id)
          }}
          onPaneClick={(e) => {
            lastPoint.current = screenToFlowPosition({ x: e.clientX, y: e.clientY })
            onSelect(null)
          }}
          onNodeDragStop={(_, n) => {
            lastPoint.current = n.position
            positions.current.set(n.id, n.position)
          }}
          onNodesDelete={(deleted) => onDeleteNodes(deleted.map((n) => n.id))}
          onEdgeClick={onEdgeClick}
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

/** How far a new node steps aside when its intended spot is already occupied. */
const SPAWN_CASCADE = 34

function freeSpot(
  taken: Iterable<{ x: number; y: number }>,
  at: { x: number; y: number },
): { x: number; y: number } {
  const others = [...taken]
  const spot = { ...at }
  while (
    others.some(
      (o) => Math.abs(o.x - spot.x) < SPAWN_CASCADE && Math.abs(o.y - spot.y) < SPAWN_CASCADE,
    )
  ) {
    spot.x += SPAWN_CASCADE
    spot.y += SPAWN_CASCADE
  }
  return spot
}

/** Screen coordinates of a drop, from either pointer family. */
function pointerPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('touches' in event) {
    const touch = event.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: event.clientX, y: event.clientY }
}
