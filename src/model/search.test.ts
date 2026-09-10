import { describe, expect, it } from 'vitest'
import type { Recipe } from './types'
import { buildIndex, markKey, searchLibrary } from './search'

const recipe = (id: string, title: string, tags: string[], ingredients: string[]): Recipe => ({
  version: 1,
  id,
  title,
  lang: 'en',
  servings: 2,
  prepMinutes: 10,
  tags,
  nodes: ingredients.map((name, i) => ({
    id: `${id}-i${i}`,
    type: 'ingredient' as const,
    inputs: [],
    name,
    qty: 1,
    unit: 'g',
  })),
  rowOrder: [],
})

const library: Recipe[] = [
  recipe('carbonara', 'Carbonara', ['pasta', 'quick'], ['spaghetti', 'egg yolks', 'pecorino']),
  recipe('spinach', 'Sautéed spinach', ['side'], ['spinach', 'garlic', 'olive oil']),
  recipe('lemon-chicken', 'Lemon chicken', ['roast'], ['chicken', 'lemon', 'garlic']),
]

const index = buildIndex(library)
const ids = (query: string) => searchLibrary(index, query).map((h) => h.recipe.id)
const hitFor = (query: string, id: string) =>
  searchLibrary(index, query).find((h) => h.recipe.id === id)

describe('searchLibrary', () => {
  it('returns the whole library for an empty query, unmarked', () => {
    const all = searchLibrary(index, '   ')
    expect(all.map((h) => h.recipe.id)).toEqual(['carbonara', 'spinach', 'lemon-chicken'])
    expect(all.every((h) => h.marks.size === 0)).toBe(true)
  })

  it('ANDs the terms', () => {
    expect(ids('lemon chicken')).toEqual(['lemon-chicken'])
    expect(ids('garlic pecorino')).toEqual([])
  })

  it('marks the matched run in the field that matched', () => {
    const hit = hitFor('garli', 'spinach')
    expect(hit?.marks.get(markKey('ingredient', 'garlic'))).toEqual(new Set([0, 1, 2, 3, 4]))
  })

  it('marks a tag hit on the tag, not on the title', () => {
    const hit = hitFor('quick', 'carbonara')
    expect(hit?.marks.has(markKey('tag', 'quick'))).toBe(true)
    expect(hit?.marks.has(markKey('title', 'Carbonara'))).toBe(false)
  })

  it('carries marks for every term of a multi-term query', () => {
    const hit = hitFor('lemon roast', 'lemon-chicken')
    expect(hit?.marks.has(markKey('ingredient', 'lemon'))).toBe(true)
    expect(hit?.marks.has(markKey('tag', 'roast'))).toBe(true)
  })

  it('does not mark a field the term only matched as scattered letters', () => {
    // 'spinach' is a far weaker subsequence match on 'Sautéed spinach' than on the
    // ingredient of the same name, and no match at all worth showing on 'side'.
    const hit = hitFor('spinach', 'spinach')
    expect(hit?.marks.has(markKey('ingredient', 'spinach'))).toBe(true)
    expect(hit?.marks.has(markKey('tag', 'side'))).toBe(false)
  })
})
