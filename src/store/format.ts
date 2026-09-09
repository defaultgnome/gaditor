import type { IngredientNode, Lang } from '../model/types'
import { localeOf } from '../i18n'

/**
 * §4.4 — scaling is exact, no rounding: the cook rounds. Repeating decimals are
 * trimmed to a few places with trailing zeros stripped, since literal no-rounding is
 * not representable.
 */
export function formatQty(value: number, lang: Lang): string {
  const nf = new Intl.NumberFormat(localeOf(lang), {
    maximumFractionDigits: 3,
    useGrouping: false,
  })
  return nf.format(value)
}

/** Empty qty/unit ⇒ the ingredient does not scale (§2.2) — `1 pinch salt`, `oil for frying`. */
export function scaledQty(node: IngredientNode, multiplier: number): number | undefined {
  if (node.qty === undefined) return undefined
  return node.qty * multiplier
}

export function ingredientLabel(node: IngredientNode, multiplier: number, lang: Lang): string {
  const qty = scaledQty(node, multiplier)
  const parts: string[] = []
  if (qty !== undefined) parts.push(formatQty(qty, lang))
  if (node.unit) parts.push(node.unit)
  parts.push(node.name)
  return parts.join(' ')
}

export function formatServings(n: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 2 }).format(n)
}
