import type { ActionNode, Lang, Recipe, RecipeNode } from './types'
import { RECIPE_VERSION } from './types'

let counter = 0

export function nodeId(prefix = 'n'): string {
  counter += 1
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`
}

export function newRecipe(id: string, lang: Lang): Recipe {
  const a = nodeId('i')
  const b = nodeId('i')
  const m = nodeId('a')
  return {
    version: RECIPE_VERSION,
    id,
    title: 'Untitled',
    lang,
    servings: 2,
    prepMinutes: 10,
    note: '',
    tags: [],
    nodes: [
      { id: a, type: 'ingredient', inputs: [], name: 'ingredient one', qty: 1, unit: 'cup' },
      { id: b, type: 'ingredient', inputs: [], name: 'ingredient two', qty: 2, unit: 'Tbs' },
      { id: m, type: 'action', inputs: [a, b], label: 'combine' },
    ],
    rowOrder: [],
  }
}

export function newNode(type: RecipeNode['type']): RecipeNode {
  switch (type) {
    case 'ingredient':
      return { id: nodeId('i'), type, inputs: [], name: 'ingredient', qty: 1, unit: '' }
    case 'action':
      return { id: nodeId('a'), type, inputs: [], label: 'step' }
    case 'wait':
      return { id: nodeId('w'), type, inputs: [], minutes: 30, label: 'rest' }
    case 'split':
      return {
        id: nodeId('s'),
        type,
        inputs: [],
        portions: [
          { percent: 75, label: '' },
          { percent: 25, label: '' },
        ],
      }
  }
}

/**
 * §6.2 — the node a connection dropped on empty canvas becomes. An unfinished
 * connection nearly always means "and then these come together", so it defaults to a
 * mix rather than to the neutral `step` the Add button produces.
 */
export function newMixNode(): ActionNode {
  return { id: nodeId('a'), type: 'action', inputs: [], label: 'mix' }
}

/**
 * A copy of `node` under a fresh id, keeping its inputs so the duplicate lands in the
 * same column, fed by the same streams — the point of duplicating a step is usually a
 * second one just like it, not a detached blank.
 */
export function cloneNode(node: RecipeNode, id: string): RecipeNode {
  const copy = { ...node, id, inputs: [...node.inputs] }
  return copy.type === 'split'
    ? { ...copy, portions: copy.portions.map((p) => ({ ...p })) }
    : copy
}
