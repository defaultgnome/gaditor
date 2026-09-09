import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Recipe, RecipeNode } from '../model/types'
import { cellText, wouldCycle } from '../solver/layout'
import { layerColumns } from '../solver/columns'

type Props = {
  recipe: Recipe
  selected: string | null
  onSelect: (id: string | null) => void
  onConnectNodes: (from: string, to: string) => void
  onDisconnect: (from: string, to: string) => void
  onDeleteNodes: (ids: string[]) => void
  cycleMessage: string
  onCycleBlocked: () => void
}

function FlowNode({ data, selected }: NodeProps) {
  const node = data.node as RecipeNode
  return (
    <div className={`flow-node k-${node.type}${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="type">{node.type}</span>
      {cellText(node) || '—'}
      <Handle type="source" position={Position.Right} />
    </div>
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
  onCycleBlocked,
}: Props) {
  const positions = useRef(new Map<string, { x: number; y: number }>())

  const layout = useMemo(() => layerColumns(recipe.nodes), [recipe.nodes])

  useEffect(() => {
    const perColumn = new Map<number, number>()
    for (const n of recipe.nodes) {
      if (positions.current.has(n.id)) continue
      const col = layout.get(n.id) ?? 0
      const row = perColumn.get(col) ?? 0
      perColumn.set(col, row + 1)
      positions.current.set(n.id, { x: col * 210, y: row * 96 })
    }
    // Keep the map from growing forever as nodes are deleted.
    const live = new Set(recipe.nodes.map((n) => n.id))
    for (const id of [...positions.current.keys()]) {
      if (!live.has(id)) positions.current.delete(id)
    }
  }, [recipe.nodes, layout])

  const nodes: Node[] = useMemo(() => {
    const perColumn = new Map<number, number>()
    return recipe.nodes.map((n) => {
      let pos = positions.current.get(n.id)
      if (!pos) {
        const col = layout.get(n.id) ?? 0
        const row = perColumn.get(col) ?? 0
        perColumn.set(col, row + 1)
        pos = { x: col * 210, y: row * 96 }
        positions.current.set(n.id, pos)
      }
      return {
        id: n.id,
        type: 'recipeNode',
        position: pos,
        data: { node: n },
        selected: n.id === selected,
      }
    })
  }, [recipe.nodes, layout, selected])

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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
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
    </div>
  )
}
