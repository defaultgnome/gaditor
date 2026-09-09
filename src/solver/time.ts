import type { RecipeNode } from '../model/types'
import { isWait, nodeMap } from '../model/types'

/**
 * §3.3 — longest-path DP over the graph: sum along a chain, `max` at a merge.
 * Two streams each resting 1h in parallel cost 1h, not 2h.
 */
export function criticalPath(nodes: RecipeNode[]): number {
  const byId = nodeMap(nodes)
  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  const upstream = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const node = byId.get(id)
    if (!node || visiting.has(id)) return 0
    visiting.add(id)
    let best = 0
    for (const input of node.inputs) {
      if (!byId.has(input)) continue
      best = Math.max(best, upstream(input))
    }
    visiting.delete(id)
    const total = best + (isWait(node) ? Math.max(0, node.minutes) : 0)
    memo.set(id, total)
    return total
  }

  let max = 0
  for (const n of nodes) max = Math.max(max, upstream(n.id))
  return max
}

/**
 * Longest downstream wait total per node — the ranking key for the default row
 * order (§3.2). Ranking by a stream's own waits alone would miss a stream that
 * waits little itself but feeds a long rest later, so this looks forward.
 */
export function downstreamWaits(nodes: RecipeNode[]): Map<string, number> {
  const byId = nodeMap(nodes)
  const consumersOf = new Map<string, string[]>()
  for (const n of nodes) consumersOf.set(n.id, [])
  for (const n of nodes) {
    for (const input of n.inputs) consumersOf.get(input)?.push(n.id)
  }

  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  const walk = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const node = byId.get(id)
    if (!node || visiting.has(id)) return 0
    visiting.add(id)
    let best = 0
    for (const c of consumersOf.get(id) ?? []) best = Math.max(best, walk(c))
    visiting.delete(id)
    const total = best + (isWait(node) ? Math.max(0, node.minutes) : 0)
    memo.set(id, total)
    return total
  }

  for (const n of nodes) walk(n.id)
  return memo
}

/** `prep 20 min + wait 1 h = 1 h 20` — the author's estimate and the derived half. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} min`
  if (rest === 0) return `${h} h`
  return `${h} h ${String(rest).padStart(2, '0')}`
}
