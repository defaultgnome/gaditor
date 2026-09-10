import { describe, expect, it } from 'vitest'
import type { IngredientNode } from '../model/types'
import { ingredientLabel, qtyText } from './format'

const ingredient = (extra: Partial<IngredientNode>): IngredientNode => ({
  id: 'i1',
  type: 'ingredient',
  inputs: [],
  name: 'yeast',
  ...extra,
})

describe('qtyText', () => {
  it('scales the quantity and keeps the unit', () => {
    expect(qtyText(ingredient({ qty: 10, unit: 'g' }), 2, 'en')).toBe('20 g')
  })

  it('renders both measures, each scaled by the same multiplier', () => {
    const node = ingredient({ qty: 1, unit: 'packet', altQty: 10, altUnit: 'g' })
    expect(qtyText(node, 1, 'en')).toBe('1 packet / 10 g')
    expect(qtyText(node, 2.5, 'en')).toBe('2.5 packet / 25 g')
  })

  it('shows the second measure alone when there is no first one', () => {
    expect(qtyText(ingredient({ altQty: 10, altUnit: 'g' }), 3, 'en')).toBe('30 g')
  })

  // §2.2 — no quantity means the ingredient does not scale, and shows no measure.
  it('renders nothing for an unmeasured ingredient', () => {
    expect(qtyText(ingredient({ unit: 'for frying' }), 4, 'en')).toBe('')
    expect(ingredientLabel(ingredient({ name: 'oil' }), 4, 'en')).toBe('oil')
  })

  it('formats in the UI locale', () => {
    expect(qtyText(ingredient({ qty: 0.5, unit: 'l' }), 1.5, 'fr')).toBe('0,75 l')
  })
})
