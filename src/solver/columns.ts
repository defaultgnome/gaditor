import type { RecipeNode } from '../model/types'
import { nodeMap } from '../model/types'

/**
 * §3.1 — longest-path layering. A node's column is 1 + max(column of its inputs);
 * sources sit at column 0. Guarantees a step never precedes its inputs.
 *
 * Cycles are hard-blocked at connect time (§3.4), but the solver must never throw:
 * an edge that would revisit an in-progress node is ignored, so the render survives
 * a corrupt import.
 */
export function layerColumns(nodes: RecipeNode[]): Map<string, number> {
  const byId = nodeMap(nodes)
  const col = new Map<string, number>()
  const visiting = new Set<string>()

  const resolve = (id: string): number => {
    const cached = col.get(id)
    if (cached !== undefined) return cached
    const node = byId.get(id)
    if (!node || visiting.has(id)) return 0
    visiting.add(id)
    let best = -1
    for (const input of node.inputs) {
      if (!byId.has(input)) continue
      best = Math.max(best, resolve(input))
    }
    visiting.delete(id)
    const value = best + 1
    col.set(id, value)
    return value
  }

  for (const n of nodes) resolve(n.id)
  return col
}

export function columnCount(columns: Map<string, number>): number {
  let max = -1
  for (const c of columns.values()) max = Math.max(max, c)
  return max + 1
}
