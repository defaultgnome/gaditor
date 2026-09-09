import { describe, expect, it } from 'vitest'
import type { Recipe, RecipeNode } from '../model/types'
import { layerColumns } from './columns'
import { criticalPath, downstreamWaits, formatDuration } from './time'
import { solveLayout, transpose, wouldCycle } from './layout'

const ing = (id: string, name = id): RecipeNode => ({
  id,
  type: 'ingredient',
  inputs: [],
  name,
  qty: 1,
  unit: 'x',
})
const act = (id: string, inputs: string[], label = id): RecipeNode => ({
  id,
  type: 'action',
  inputs,
  label,
})
const wait = (id: string, inputs: string[], minutes: number): RecipeNode => ({
  id,
  type: 'wait',
  inputs,
  minutes,
  label: `rest ${minutes}`,
})

const recipe = (nodes: RecipeNode[], rowOrder: string[] = []): Recipe => ({
  version: 1,
  id: 'test',
  title: 'test',
  lang: 'en',
  servings: 2,
  prepMinutes: 0,
  tags: [],
  nodes,
  rowOrder,
})

// --- 1. Column layering -------------------------------------------------

describe('column layering', () => {
  it('puts sources at column 0', () => {
    const cols = layerColumns([ing('a'), ing('b')])
    expect(cols.get('a')).toBe(0)
    expect(cols.get('b')).toBe(0)
  })

  it('places a node one past the longest of its inputs', () => {
    const nodes = [ing('a'), ing('b'), act('x', ['a']), act('y', ['b', 'x'])]
    const cols = layerColumns(nodes)
    expect(cols.get('x')).toBe(1)
    expect(cols.get('y')).toBe(2)
  })

  it('never lets a step precede its inputs', () => {
    const nodes = [
      ing('a'),
      ing('b'),
      ing('c'),
      act('m', ['a', 'b']),
      act('n', ['m']),
      act('o', ['c', 'n']),
      act('p', ['a', 'o']),
    ]
    const cols = layerColumns(nodes)
    for (const n of nodes) {
      for (const i of n.inputs) {
        expect(cols.get(n.id)!).toBeGreaterThan(cols.get(i)!)
      }
    }
  })

  it('uses the longest path, not the shortest', () => {
    // a -> x -> y -> z and a -> z: z must sit past y, not past a.
    const nodes = [ing('a'), act('x', ['a']), act('y', ['x']), act('z', ['a', 'y'])]
    expect(layerColumns(nodes).get('z')).toBe(3)
  })

  it('survives a cycle rather than hanging', () => {
    const nodes: RecipeNode[] = [act('x', ['y']), act('y', ['x'])]
    const cols = layerColumns(nodes)
    expect(cols.size).toBe(2)
  })

  it('ignores dangling input ids', () => {
    const nodes = [act('x', ['ghost'])]
    expect(layerColumns(nodes).get('x')).toBe(0)
  })
})

// --- 2. Critical path ---------------------------------------------------

describe('critical path', () => {
  it('is zero with no waits', () => {
    expect(criticalPath([ing('a'), act('x', ['a'])])).toBe(0)
  })

  it('sums along a chain', () => {
    const nodes = [ing('a'), wait('w1', ['a'], 30), wait('w2', ['w1'], 45)]
    expect(criticalPath(nodes)).toBe(75)
  })

  it('takes the max at a merge — parallel waits overlap', () => {
    const nodes = [
      ing('a'),
      ing('b'),
      wait('wa', ['a'], 60),
      wait('wb', ['b'], 60),
      act('m', ['wa', 'wb']),
    ]
    expect(criticalPath(nodes)).toBe(60)
  })

  it('picks the longer branch at a merge', () => {
    const nodes = [
      ing('a'),
      ing('b'),
      wait('wa', ['a'], 20),
      wait('wb', ['b'], 90),
      act('m', ['wa', 'wb']),
      wait('after', ['m'], 10),
    ]
    expect(criticalPath(nodes)).toBe(100)
  })

  it('counts a wait on a branch that never merges back', () => {
    const nodes = [ing('a'), wait('w', ['a'], 15), ing('b')]
    expect(criticalPath(nodes)).toBe(15)
  })

  it('does not hang on a cycle', () => {
    const nodes: RecipeNode[] = [wait('x', ['y'], 10), wait('y', ['x'], 10)]
    expect(criticalPath(nodes)).toBeGreaterThanOrEqual(10)
  })

  it('ranks streams by downstream wait, not their own', () => {
    // b waits nothing itself but feeds a long rest; a rests briefly and stops.
    const nodes = [
      ing('a'),
      ing('b'),
      wait('wa', ['a'], 5),
      act('mix', ['b']),
      wait('long', ['mix'], 120),
      act('end', ['wa', 'long']),
    ]
    const d = downstreamWaits(nodes)
    expect(d.get('b')!).toBe(120)
    expect(d.get('a')!).toBe(5)
  })

  it('formats a breakdown readably', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(20)).toBe('20 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(80)).toBe('1 h 20')
    expect(formatDuration(65)).toBe('1 h 05')
  })
})

// --- 3. Row ordering and contiguity ------------------------------------

const rowIds = (r: Recipe) => solveLayout(r).rows.map((x) => x.id)

describe('row ordering', () => {
  it('floats the stream with the most waiting ahead of it to the top', () => {
    const nodes = [
      ing('quick'),
      ing('slow'),
      wait('rest', ['slow'], 120),
      act('end', ['quick', 'rest']),
    ]
    expect(rowIds(recipe(nodes))).toEqual(['slow', 'quick'])
  })

  it('honours a rowOrder override', () => {
    const nodes = [
      ing('quick'),
      ing('slow'),
      wait('rest', ['slow'], 120),
      act('end', ['quick', 'rest']),
    ]
    expect(rowIds(recipe(nodes, ['quick', 'slow']))).toEqual(['quick', 'slow'])
  })

  it('keeps merged rows adjacent even when the override splits them', () => {
    // ab merges a and b; the override asks for a, c, b — impossible to honour exactly.
    const nodes = [ing('a'), ing('b'), ing('c'), act('ab', ['a', 'b']), act('end', ['ab', 'c'])]
    const layout = solveLayout(recipe(nodes, ['a', 'c', 'b']))
    const idx = new Map(layout.rows.map((r, i) => [r.id, i]))
    expect(Math.abs(idx.get('a')! - idx.get('b')!)).toBe(1)
  })

  it('satisfies contiguity for every merge in a nested graph', () => {
    const nodes = [
      ing('a'),
      ing('b'),
      ing('c'),
      ing('d'),
      act('ab', ['a', 'b']),
      act('cd', ['c', 'd']),
      act('all', ['ab', 'cd']),
    ]
    const layout = solveLayout(recipe(nodes, ['a', 'c', 'b', 'd']))
    const idx = new Map(layout.rows.map((r, i) => [r.id, i]))
    for (const pair of [
      ['a', 'b'],
      ['c', 'd'],
    ]) {
      expect(Math.abs(idx.get(pair[0])! - idx.get(pair[1])!)).toBe(1)
    }
    expect(layout.rows).toHaveLength(4)
  })

  it('emits a reference marker instead of failing when contiguity is impossible', () => {
    // a is consumed by two different merges that cannot both sit next to it.
    const nodes = [
      ing('a'),
      ing('b'),
      ing('c'),
      act('ab', ['a', 'b']),
      act('abc', ['ab', 'c']),
      act('ac', ['a', 'c']),
      act('end', ['abc', 'ac']),
    ]
    const layout = solveLayout(recipe(nodes))
    expect(layout.rows).toHaveLength(3)
    const refs = layout.cells.flatMap((c) => [...c.refIn, ...c.refOut])
    expect(refs.length).toBeGreaterThan(0)
  })

  it('always renders — every grid position is covered by exactly one cell', () => {
    const nodes = [ing('a'), ing('b'), ing('c'), act('ab', ['a', 'b']), act('all', ['ab', 'c'])]
    const layout = solveLayout(recipe(nodes))
    const grid = new Set<string>()
    for (const cell of layout.cells) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
          expect(grid.has(`${r},${c}`)).toBe(false)
          grid.add(`${r},${c}`)
        }
      }
    }
    expect(grid.size).toBe(layout.rows.length * layout.colCount)
  })

  it('spawns a row per split portion beyond the first', () => {
    const nodes: RecipeNode[] = [
      ing('dough'),
      {
        id: 'sp',
        type: 'split',
        inputs: ['dough'],
        portions: [
          { percent: 75, label: '' },
          { percent: 25, label: '' },
        ],
      },
      act('bake', ['sp']),
      act('freeze', ['sp']),
    ]
    const layout = solveLayout(recipe(nodes))
    expect(layout.rows.map((r) => r.kind)).toContain('portion')
    expect(layout.rows).toHaveLength(2)
    const splitCell = layout.cells.find((c) => c.nodeId === 'sp')!
    expect(splitCell.refOut.some((r) => r.includes('25%'))).toBe(true)
  })

  it('renders an orphan node as its own visible row rather than dropping it', () => {
    const nodes = [ing('a'), act('lonely', [])]
    const layout = solveLayout(recipe(nodes))
    expect(layout.cells.some((c) => c.nodeId === 'lonely')).toBe(true)
    expect(layout.warnings.some((w) => w.kind === 'orphan')).toBe(true)
  })

  it('never leaves a blank cell — an idle ingredient stretches rightward', () => {
    const nodes = [ing('a'), ing('salt'), act('cook', ['a']), act('season', ['cook', 'salt'])]
    const layout = solveLayout(recipe(nodes))
    const saltRow = layout.rows.findIndex((r) => r.id === 'salt')
    const saltCell = layout.cells.find((c) => c.nodeId === 'salt' && c.row === saltRow)!
    expect(saltCell.colSpan).toBe(2)
  })

  it('transposes to the same layout with axes swapped', () => {
    const nodes = [ing('a'), ing('b'), act('m', ['a', 'b'])]
    const h = solveLayout(recipe(nodes))
    const v = transpose(h)
    expect(v.cells).toHaveLength(h.cells.length)
    const hm = h.cells.find((c) => c.nodeId === 'm')!
    const vm = v.cells.find((c) => c.nodeId === 'm')!
    expect(vm.row).toBe(hm.col)
    expect(vm.colSpan).toBe(hm.rowSpan)
  })
})

describe('cycle guard', () => {
  it('blocks a self connection', () => {
    expect(wouldCycle([ing('a')], 'a', 'a')).toBe(true)
  })
  it('blocks a back edge', () => {
    const nodes = [ing('a'), act('x', ['a'])]
    expect(wouldCycle(nodes, 'x', 'a')).toBe(true)
  })
  it('allows a forward edge', () => {
    const nodes = [ing('a'), ing('b'), act('x', ['a'])]
    expect(wouldCycle(nodes, 'b', 'x')).toBe(false)
  })
})

describe('orphan rows participate in ordering', () => {
  const nodes = [ing('a'), ing('b'), act('orph', []), act('end', ['a', 'b', 'orph'])]

  it('is placed by the merge tree, not appended as a leftover', () => {
    // An orphan opens a row of its own, so it must be a leaf of the merge tree —
    // otherwise rowOrder can never move it.
    const layout = solveLayout(recipe(nodes, ['b', 'orph', 'a']))
    expect(layout.rows.map((r) => r.id)).toEqual(['b', 'orph', 'a'])
  })

  it('still renders when it is the only node', () => {
    const layout = solveLayout(recipe([act('lonely', [])]))
    expect(layout.rows.map((r) => r.id)).toEqual(['lonely'])
    expect(layout.cells).toHaveLength(1)
  })
})
