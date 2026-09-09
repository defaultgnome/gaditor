/** Data model — §2 of SPEC.md. The graph is the source of truth. */

export const RECIPE_VERSION = 1
export const BUNDLE_VERSION = 1

export type Lang = 'en' | 'fr'

export type NodeType = 'ingredient' | 'action' | 'split' | 'wait'

export type BaseNode = {
  id: string
  type: NodeType
  /** node ids feeding this node */
  inputs: string[]
}

export type IngredientNode = BaseNode & {
  type: 'ingredient'
  name: string
  /** empty qty/unit ⇒ the ingredient does not scale (§2.2) */
  qty?: number
  unit?: string
  /** id of another recipe — a subrecipe reference */
  ref?: string
}

export type ActionNode = BaseNode & {
  type: 'action'
  label: string
}

export type SplitPortion = {
  percent: number
  /** auto-assigned marker: A, B, C … for every portion after the first */
  label: string
}

export type SplitNode = BaseNode & {
  type: 'split'
  portions: SplitPortion[]
}

export type WaitNode = BaseNode & {
  type: 'wait'
  minutes: number
  label: string
}

export type RecipeNode = IngredientNode | ActionNode | SplitNode | WaitNode

export type Recipe = {
  version: number
  /** human-readable slug, stable forever */
  id: string
  title: string
  lang: Lang
  servings: number
  prepMinutes: number
  note?: string
  tags: string[]
  nodes: RecipeNode[]
  /** presentation override, §3.2 */
  rowOrder: string[]
}

export type Bundle = {
  version: number
  recipes: Recipe[]
}

export const isIngredient = (n: RecipeNode): n is IngredientNode => n.type === 'ingredient'
export const isSplit = (n: RecipeNode): n is SplitNode => n.type === 'split'
export const isWait = (n: RecipeNode): n is WaitNode => n.type === 'wait'

/** Stable index for O(1) lookups during solving. */
export function nodeMap(nodes: RecipeNode[]): Map<string, RecipeNode> {
  return new Map(nodes.map((n) => [n.id, n]))
}

/** Reverse adjacency: node id → ids of nodes consuming it. */
export function consumers(nodes: RecipeNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const n of nodes) out.set(n.id, [])
  for (const n of nodes) {
    for (const i of n.inputs) {
      const list = out.get(i)
      if (list) list.push(n.id)
    }
  }
  return out
}
