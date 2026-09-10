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

/** A unit with no quantity is not a measure — `oil for frying` renders as bare text. */
function measure(
  qty: number | undefined,
  unit: string | undefined,
  multiplier: number,
  lang: Lang,
): string {
  if (qty === undefined) return ''
  return unit
    ? `${formatQty(qty * multiplier, lang)} ${unit}`
    : formatQty(qty * multiplier, lang)
}

/**
 * §2.2 — the measure shown ahead of the ingredient name: `10 g`, or `1 packet / 10 g`
 * when a second unit is given. Both halves take the same multiplier, so a doubled
 * recipe reads `2 packets / 20 g` and neither half drifts from the other.
 */
export function qtyText(node: IngredientNode, multiplier: number, lang: Lang): string {
  return [
    measure(node.qty, node.unit, multiplier, lang),
    measure(node.altQty, node.altUnit, multiplier, lang),
  ]
    .filter(Boolean)
    .join(' / ')
}

export function ingredientLabel(node: IngredientNode, multiplier: number, lang: Lang): string {
  const qty = qtyText(node, multiplier, lang)
  return qty ? `${qty} ${node.name}` : node.name
}

export function formatServings(n: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 2 }).format(n)
}
