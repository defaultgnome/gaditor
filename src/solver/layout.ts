import type { RecipeNode, Recipe, SplitNode } from '../model/types'
import { nodeMap, consumers } from '../model/types'
import { layerColumns, columnCount } from './columns'
import { downstreamWaits } from './time'
import { makeLabeller } from './labels'

/** A row is a stream: an ingredient source, or a portion spawned by a split (§3.2). */
export type StreamRow = {
  id: string
  kind: 'ingredient' | 'portion' | 'orphan'
  /** ingredient node id, or the split that emitted this portion */
  sourceNodeId: string
  portionIndex?: number
  /** auto-label shown in the leftmost cell of a spawned row */
  label?: string
}

export type CellKind = 'ingredient' | 'action' | 'split' | 'wait' | 'marker'

export type Cell = {
  key: string
  row: number
  col: number
  rowSpan: number
  colSpan: number
  kind: CellKind
  /** undefined for spawned-row markers */
  nodeId?: string
  /**
   * §4.3 — the identity a done mark hangs off. Every cell has one, including the
   * spawned-row markers that have no node behind them: a marker is a step the cook
   * works through like any other, so it has to be tickable.
   */
  doneKey: string
  text: string
  /** streams this cell emits by reference */
  refOut: string[]
  /** streams this cell consumes by reference rather than adjacency */
  refIn: string[]
}

export type Warning = {
  kind: 'cycle' | 'multiple-terminals' | 'orphan' | 'missing-qty' | 'empty-label'
  nodeIds: string[]
}

export type Layout = {
  rows: StreamRow[]
  colCount: number
  cells: Cell[]
  columns: Map<string, number>
  warnings: Warning[]
}

export const portionRowId = (splitId: string, index: number) => `${splitId}#${index}`

/**
 * §2.2 — a split's portions bind to its consumers in order: the first consumer takes
 * portion 0 (which continues on the current row), the second takes portion 1 (row A),
 * and so on. Extra consumers fall back to portion 0. This keeps inputs a flat list of
 * node ids while still letting a later node pick up a spawned remainder.
 */
function splitBindings(
  nodes: RecipeNode[],
  columns: Map<string, number>,
  consumersOf: Map<string, string[]>,
): Map<string, number> {
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const binding = new Map<string, number>()
  for (const n of nodes) {
    if (n.type !== 'split') continue
    const cs = [...(consumersOf.get(n.id) ?? [])].sort((a, b) => {
      const ca = columns.get(a) ?? 0
      const cb = columns.get(b) ?? 0
      return ca - cb || (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
    cs.forEach((consumerId, i) => {
      binding.set(`${n.id}->${consumerId}`, Math.min(i, Math.max(0, n.portions.length - 1)))
    })
  }
  return binding
}

function meanOf(values: number[]): number {
  if (values.length === 0) return Number.MAX_SAFE_INTEGER
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function solveLayout(recipe: Recipe): Layout {
  const nodes = recipe.nodes
  const byId = nodeMap(nodes)
  const columns = layerColumns(nodes)
  const colCount = Math.max(1, columnCount(columns))
  const consumersOf = consumers(nodes)
  const binding = splitBindings(nodes, columns, consumersOf)
  const nextLabel = makeLabeller()

  // ---- 1. Streams -------------------------------------------------------
  const rows: StreamRow[] = []
  const nodeOrder = new Map(nodes.map((n, i) => [n.id, i]))
  const byColumnThenOrder = [...nodes].sort(
    (a, b) =>
      (columns.get(a.id) ?? 0) - (columns.get(b.id) ?? 0) ||
      (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0),
  )
  for (const n of nodes) {
    if (n.type === 'ingredient') {
      rows.push({ id: n.id, kind: 'ingredient', sourceNodeId: n.id })
    }
  }
  const portionLabels = new Map<string, string>()
  for (const n of byColumnThenOrder) {
    if (n.type !== 'split') continue
    n.portions.forEach((p, i) => {
      if (i === 0) return // the first portion continues on the current row
      const label = p.label || nextLabel()
      portionLabels.set(portionRowId(n.id, i), label)
      rows.push({
        id: portionRowId(n.id, i),
        kind: 'portion',
        sourceNodeId: n.id,
        portionIndex: i,
        label,
      })
    })
  }

  // ---- 2. Ideal rows per node ------------------------------------------
  const idealRows = new Map<string, string[]>()
  const boundRows = (inputId: string, consumerId: string): string[] => {
    const input = byId.get(inputId)
    if (!input) return []
    if (input.type === 'split') {
      const k = binding.get(`${inputId}->${consumerId}`) ?? 0
      if (k > 0) return [portionRowId(inputId, k)]
    }
    return idealRows.get(inputId) ?? []
  }
  for (const n of byColumnThenOrder) {
    if (n.type === 'ingredient') {
      idealRows.set(n.id, [n.id])
      continue
    }
    const set: string[] = []
    for (const i of n.inputs) {
      for (const r of boundRows(i, n.id)) if (!set.includes(r)) set.push(r)
    }
    // §3.4 — an orphan (or a node whose inputs all dangle) gets its own row so it stays
    // visible. The render never silently drops a node.
    if (set.length === 0) {
      set.push(n.id)
      rows.push({ id: n.id, kind: 'orphan', sourceNodeId: n.id })
    }
    idealRows.set(n.id, set)
  }
  const rowExists = new Set(rows.map((r) => r.id))

  // ---- 3. Preferred order ----------------------------------------------
  const waits = downstreamWaits(nodes)
  const originalIndex = new Map(rows.map((r, i) => [r.id, i]))
  const preferred = [...rows].sort((a, b) => {
    const ia = recipe.rowOrder.indexOf(a.id)
    const ib = recipe.rowOrder.indexOf(b.id)
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    }
    // Default: descending downstream wait total — the stream with the most waiting
    // ahead of it is the one you must start first, so it floats to the top.
    const wa = waits.get(a.sourceNodeId) ?? 0
    const wb = waits.get(b.sourceNodeId) ?? 0
    return wb - wa || (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0)
  })
  const desired = new Map(preferred.map((r, i) => [r.id, i]))

  // ---- 4. Contiguity: merge tree, children ordered by subtree mean -------
  const groupMemo = new Map<string, string[]>()
  const grouping = new Set<string>()
  const groupOf = (nodeId: string): string[] => {
    const cached = groupMemo.get(nodeId)
    if (cached) return cached
    const n = byId.get(nodeId)
    if (!n || grouping.has(nodeId)) return []
    // A node that opens a row of its own — an ingredient, or an orphan whose inputs
    // resolve to nothing — is a leaf of the merge tree. Without this an orphan drops
    // out of the tree entirely and rowOrder can never position it.
    if (rowExists.has(nodeId)) {
      groupMemo.set(nodeId, [nodeId])
      return [nodeId]
    }
    grouping.add(nodeId)
    const children = n.inputs
      .filter((i) => byId.has(i))
      .map((i) => {
        const input = byId.get(i)!
        if (input.type === 'split') {
          const k = binding.get(`${i}->${nodeId}`) ?? 0
          if (k > 0) return [portionRowId(i, k)]
        }
        return groupOf(i)
      })
      .filter((g) => g.length > 0)
    grouping.delete(nodeId)
    children.sort(
      (a, b) =>
        meanOf(a.map((r) => desired.get(r) ?? 0)) - meanOf(b.map((r) => desired.get(r) ?? 0)),
    )
    const out: string[] = []
    for (const g of children) for (const r of g) if (!out.includes(r)) out.push(r)
    groupMemo.set(nodeId, out)
    return out
  }

  const emitted: string[] = []
  const seen = new Set<string>()
  const push = (rowIds: string[]) => {
    for (const r of rowIds) {
      if (!seen.has(r) && rowExists.has(r)) {
        seen.add(r)
        emitted.push(r)
      }
    }
  }
  const terminals = nodes
    .filter((n) => (consumersOf.get(n.id) ?? []).length === 0)
    .sort(
      (a, b) =>
        meanOf(groupOf(a.id).map((r) => desired.get(r) ?? 0)) -
        meanOf(groupOf(b.id).map((r) => desired.get(r) ?? 0)),
    )
  for (const t of terminals) push(groupOf(t.id))
  // Sweep anything a terminal could not reach (e.g. a split whose only consumer takes
  // a spawned portion), deepest first, then any leftover row in preference order.
  for (const n of [...byColumnThenOrder].reverse()) push(groupOf(n.id))
  push(preferred.map((r) => r.id))

  const rowsById = new Map(rows.map((r) => [r.id, r]))
  const finalRows = emitted.map((id) => rowsById.get(id)!)
  const rowIndex = new Map(finalRows.map((r, i) => [r.id, i]))

  // ---- 5. Detachment fallback (§3.2) ------------------------------------
  // When no contiguous order exists the solver never fails: the odd stream out keeps
  // its own rows and is pulled in by reference instead of merged into a taller cell.
  const effRows = new Map<string, string[]>()
  const refOut = new Map<string, string[]>()
  const refIn = new Map<string, string[]>()
  const addRef = (m: Map<string, string[]>, id: string, v: string) => {
    const list = m.get(id) ?? []
    list.push(v)
    m.set(id, list)
  }

  for (const n of byColumnThenOrder) {
    if (n.type === 'ingredient') {
      effRows.set(n.id, [n.id])
      continue
    }
    type Group = { inputId: string; label?: string; rows: number[] }
    const groups: Group[] = []
    for (const i of n.inputs) {
      const input = byId.get(i)
      if (!input) continue
      let rowIds: string[]
      let label: string | undefined
      if (input.type === 'split') {
        const k = binding.get(`${i}->${n.id}`) ?? 0
        if (k > 0) {
          rowIds = [portionRowId(i, k)]
          label = portionLabels.get(portionRowId(i, k))
        } else {
          rowIds = effRows.get(i) ?? []
        }
      } else {
        rowIds = effRows.get(i) ?? []
      }
      const idxs = rowIds
        .map((r) => rowIndex.get(r))
        .filter((x): x is number => x !== undefined)
        .sort((a, b) => a - b)
      if (idxs.length === 0) continue
      groups.push({ inputId: i, label, rows: idxs })
    }
    groups.sort((a, b) => a.rows[0] - b.rows[0])

    // Longest chain of groups that are adjacent in the final order wins the merge.
    let bestStart = 0
    let bestEnd = 0
    let bestSize = groups.length ? groups[0].rows.length : 0
    let start = 0
    let size = bestSize
    for (let k = 1; k < groups.length; k++) {
      const prev = groups[k - 1]
      const adjacent = prev.rows[prev.rows.length - 1] + 1 === groups[k].rows[0]
      if (adjacent) {
        size += groups[k].rows.length
      } else {
        start = k
        size = groups[k].rows.length
      }
      if (size > bestSize) {
        bestSize = size
        bestStart = start
        bestEnd = k
      }
    }

    const merged: string[] = []
    groups.forEach((g, k) => {
      if (k >= bestStart && k <= bestEnd) {
        for (const idx of g.rows) merged.push(finalRows[idx].id)
      } else {
        const label = g.label ?? nextLabel()
        addRef(refOut, g.inputId, label)
        addRef(refIn, n.id, label)
      }
    })
    effRows.set(n.id, merged.length ? merged : (idealRows.get(n.id) ?? []))
  }

  // A split always announces its spawned portions on its own cell.
  for (const n of nodes) {
    if (n.type !== 'split') continue
    n.portions.forEach((p, i) => {
      if (i === 0) return
      const label = portionLabels.get(portionRowId(n.id, i))
      if (label) addRef(refOut, n.id, `${p.percent}% → ${label}`)
    })
  }

  // ---- 6. Ownership grid -------------------------------------------------
  const rowCount = finalRows.length
  const owner: (string | null)[][] = Array.from({ length: rowCount }, () =>
    Array<string | null>(colCount).fill(null),
  )
  // Candidates per row: every node whose effective rows include it, plus the synthetic
  // marker that opens a spawned row at column 0.
  const candidates: { id: string; col: number }[][] = Array.from({ length: rowCount }, () => [])
  finalRows.forEach((r, i) => {
    if (r.kind === 'portion') candidates[i].push({ id: `marker:${r.id}`, col: 0 })
  })
  for (const n of nodes) {
    const c = columns.get(n.id) ?? 0
    for (const r of effRows.get(n.id) ?? []) {
      const i = rowIndex.get(r)
      if (i !== undefined) candidates[i].push({ id: n.id, col: c })
    }
  }
  for (let i = 0; i < rowCount; i++) {
    const list = [...candidates[i]].sort((a, b) => a.col - b.col)
    // Rule 5: a cell spans rightward until its output is consumed — the owner of a
    // column is the deepest node that has started by then. Cells are never blank.
    let current: string | null = list.length ? list[0].id : null
    let k = 0
    for (let c = 0; c < colCount; c++) {
      while (k < list.length && list[k].col <= c) {
        current = list[k].id
        k++
      }
      owner[i][c] = current
    }
  }

  // ---- 7. Rectangles ----------------------------------------------------
  const claimed: boolean[][] = Array.from({ length: rowCount }, () =>
    Array<boolean>(colCount).fill(false),
  )
  const cells: Cell[] = []

  const makeCell = (
    id: string,
    row: number,
    col: number,
    rowSpan: number,
    colSpan: number,
  ): Cell => {
    if (id.startsWith('marker:')) {
      const rowId = id.slice('marker:'.length)
      return {
        key: `${id}@${row},${col}`,
        row,
        col,
        rowSpan,
        colSpan,
        kind: 'marker',
        doneKey: id,
        text: rowsById.get(rowId)?.label ?? '?',
        refOut: [],
        refIn: [],
      }
    }
    const n = byId.get(id)!
    return {
      key: `${id}@${row},${col}`,
      row,
      col,
      rowSpan,
      colSpan,
      kind: n.type,
      nodeId: n.id,
      doneKey: n.id,
      text: cellText(n),
      refOut: refOut.get(n.id) ?? [],
      refIn: refIn.get(n.id) ?? [],
    }
  }

  for (let i = 0; i < rowCount; i++) {
    for (let c = 0; c < colCount; c++) {
      if (claimed[i][c]) continue
      const id = owner[i][c]
      if (id === null) {
        claimed[i][c] = true
        continue
      }
      let colSpan = 1
      while (c + colSpan < colCount && owner[i][c + colSpan] === id && !claimed[i][c + colSpan])
        colSpan++
      let rowSpan = 1
      outer: while (i + rowSpan < rowCount) {
        for (let x = c; x < c + colSpan; x++) {
          if (owner[i + rowSpan][x] !== id || claimed[i + rowSpan][x]) break outer
        }
        rowSpan++
      }
      for (let y = i; y < i + rowSpan; y++)
        for (let x = c; x < c + colSpan; x++) claimed[y][x] = true
      cells.push(makeCell(id, i, c, rowSpan, colSpan))
    }
  }

  return {
    rows: finalRows,
    colCount,
    cells,
    columns,
    warnings: collectWarnings(nodes, consumersOf),
  }
}

export function cellText(n: RecipeNode): string {
  switch (n.type) {
    case 'ingredient':
      return n.name
    case 'action':
      return n.label
    case 'wait':
      return n.label
    case 'split':
      return n.portions.length ? `split ${n.portions[0].percent}%` : 'split'
  }
}

export function splitPortionsText(n: SplitNode): string {
  return n.portions.map((p) => `${p.percent}%`).join(' / ')
}

function collectWarnings(nodes: RecipeNode[], consumersOf: Map<string, string[]>): Warning[] {
  const out: Warning[] = []
  const terminals = nodes.filter((n) => (consumersOf.get(n.id) ?? []).length === 0)
  if (terminals.length > 1) {
    out.push({ kind: 'multiple-terminals', nodeIds: terminals.map((n) => n.id) })
  }
  const orphans = nodes.filter(
    (n) =>
      n.inputs.length === 0 &&
      n.type !== 'ingredient' &&
      (consumersOf.get(n.id) ?? []).length === 0,
  )
  if (orphans.length) out.push({ kind: 'orphan', nodeIds: orphans.map((n) => n.id) })

  const missingQty = nodes.filter(
    (n) => n.type === 'ingredient' && !n.ref && n.qty === undefined && n.altQty === undefined,
  )
  if (missingQty.length) out.push({ kind: 'missing-qty', nodeIds: missingQty.map((n) => n.id) })

  const emptyLabel = nodes.filter((n) => cellText(n).trim() === '')
  if (emptyLabel.length) out.push({ kind: 'empty-label', nodeIds: emptyLabel.map((n) => n.id) })

  const cyclic = findCycleNodes(nodes)
  if (cyclic.length) out.push({ kind: 'cycle', nodeIds: cyclic })
  return out
}

/** §3.4 — cycles are blocked at connect time, but an imported graph may still carry one. */
export function findCycleNodes(nodes: RecipeNode[]): string[] {
  const byId = nodeMap(nodes)
  const state = new Map<string, 0 | 1 | 2>()
  const bad = new Set<string>()
  const walk = (id: string) => {
    const s = state.get(id) ?? 0
    if (s === 1) {
      bad.add(id)
      return
    }
    if (s === 2) return
    state.set(id, 1)
    for (const i of byId.get(id)?.inputs ?? []) if (byId.has(i)) walk(i)
    state.set(id, 2)
  }
  for (const n of nodes) walk(n.id)
  return [...bad]
}

/** §4.2 — vertical is a pure transpose of the same solved layout. */
export function transpose(layout: Layout): Layout {
  return {
    ...layout,
    cells: layout.cells.map((c) => ({
      ...c,
      row: c.col,
      col: c.row,
      rowSpan: c.colSpan,
      colSpan: c.rowSpan,
    })),
  }
}

/** Does adding from -> to create a cycle? Used to hard-block a connection (§3.4). */
export function wouldCycle(nodes: RecipeNode[], from: string, to: string): boolean {
  if (from === to) return true
  const byId = nodeMap(nodes)
  const stack = [from]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const i of byId.get(id)?.inputs ?? []) stack.push(i)
  }
  return false
}
