import type { Bundle, Recipe, RecipeNode } from '../model/types'
import { BUNDLE_VERSION, RECIPE_VERSION } from '../model/types'

/** §7.2 — versioned key, so a format change never silently poisons an old overlay. */
export const OVERLAY_KEY = 'gaditor:v1:overlay'
export const PREFS_KEY = 'gaditor:v1:prefs'

export type Overlay = {
  version: number
  /** id → recipe: created recipes and edited copies */
  recipes: Record<string, Recipe>
  /** ids of published recipes deleted locally */
  tombstones: string[]
}

export const emptyOverlay = (): Overlay => ({
  version: BUNDLE_VERSION,
  recipes: {},
  tombstones: [],
})

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadOverlay(): Overlay {
  const parsed = safeParse<Partial<Overlay>>(localStorage.getItem(OVERLAY_KEY))
  if (!parsed) return emptyOverlay()
  return {
    version: parsed.version ?? BUNDLE_VERSION,
    recipes: Object.fromEntries(
      Object.entries(parsed.recipes ?? {}).map(([id, r]) => [id, migrateRecipe(r as Recipe)]),
    ),
    tombstones: parsed.tombstones ?? [],
  }
}

export function saveOverlay(overlay: Overlay): void {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay))
  } catch {
    // A full or blocked localStorage must not take the app down.
  }
}

/**
 * §7.1 — one bundle, fetched on every load. The `version` field means a format change
 * migrates on load rather than breaking silently.
 */
export function migrateRecipe(input: Recipe): Recipe {
  const r = { ...input } as Recipe
  r.version = RECIPE_VERSION
  r.tags ??= []
  r.rowOrder ??= []
  r.nodes = (r.nodes ?? []).map(migrateNode)
  r.servings = Number(r.servings) || 1
  r.prepMinutes = Number(r.prepMinutes) || 0
  r.lang = r.lang === 'fr' ? 'fr' : 'en'
  r.title ??= r.id
  return r
}

function migrateNode(n: RecipeNode): RecipeNode {
  const base = { ...n, inputs: n.inputs ?? [] }
  switch (base.type) {
    case 'ingredient':
      return {
        ...base,
        inputs: [],
        name: base.name ?? '',
        qty: base.qty === undefined || base.qty === null ? undefined : Number(base.qty),
        unit: base.unit || undefined,
        ref: base.ref || undefined,
      }
    case 'wait':
      return { ...base, minutes: Number(base.minutes) || 0, label: base.label ?? '' }
    case 'split':
      return {
        ...base,
        portions: (base.portions ?? []).map((p) => ({
          percent: Number(p.percent) || 0,
          label: p.label ?? '',
        })),
      }
    default:
      return { ...base, label: base.label ?? '' }
  }
}

export function migrateBundle(input: unknown): Bundle {
  const b = (input ?? {}) as Partial<Bundle>
  return {
    version: BUNDLE_VERSION,
    recipes: (b.recipes ?? []).map(migrateRecipe),
  }
}

/**
 * §7.2 — local wins. A recipe never touched locally always reflects the latest
 * published version; an edited one stays yours until reverted.
 */
export function mergeLibrary(base: Recipe[], overlay: Overlay): Recipe[] {
  const tomb = new Set(overlay.tombstones)
  const out: Recipe[] = []
  const taken = new Set<string>()
  for (const r of base) {
    if (tomb.has(r.id)) continue
    const local = overlay.recipes[r.id]
    out.push(local ?? r)
    taken.add(r.id)
  }
  for (const [id, r] of Object.entries(overlay.recipes)) {
    if (!taken.has(id) && !tomb.has(id)) out.push(r)
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

export function isModifiedLocally(id: string, overlay: Overlay): boolean {
  return id in overlay.recipes
}

export function exportBundle(recipes: Recipe[]): string {
  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    recipes: [...recipes].sort((a, b) => a.id.localeCompare(b.id)),
  }
  return JSON.stringify(bundle, null, 2) + '\n'
}

export function exportRecipe(recipe: Recipe): string {
  return JSON.stringify(recipe, null, 2) + '\n'
}

/** Accepts either a whole bundle or a single recipe (§7.3). */
export function parseImport(text: string): Recipe[] | null {
  const parsed = safeParse<unknown>(text.trim())
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (Array.isArray(obj.recipes)) return migrateBundle(obj).recipes
  if (Array.isArray(parsed)) return (parsed as Recipe[]).map(migrateRecipe)
  if (typeof obj.id === 'string' && Array.isArray(obj.nodes))
    return [migrateRecipe(parsed as Recipe)]
  return null
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Stable, human-readable slug — ids never change once published (§7.1). */
export function slugify(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'recipe'
}

export function uniqueId(title: string, taken: Set<string>): string {
  const base = slugify(title)
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}
