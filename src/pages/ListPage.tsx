import { useMemo } from 'react'
import fuzzysort from 'fuzzysort'
import type { Recipe } from '../model/types'
import { useApp } from '../store/app'
import { navigate, useQueryParam, type Route } from '../store/router'
import { criticalPath, formatDuration } from '../solver/time'
import { isModifiedLocally, uniqueId } from '../store/storage'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { newRecipe } from '../model/factory'

type Indexed = {
  recipe: Recipe
  haystack: string
  prepared: Fuzzysort.Prepared
}

/** §6.1 — the index covers title + tags + ingredient names. */
function buildIndex(library: Recipe[]): Indexed[] {
  return library.map((recipe) => {
    const ingredients = recipe.nodes
      .filter((n) => n.type === 'ingredient')
      .map((n) => (n.type === 'ingredient' ? n.name : ''))
    const haystack = [recipe.title, ...recipe.tags, ...ingredients].join(' ')
    return { recipe, haystack, prepared: fuzzysort.prepare(haystack) }
  })
}

/**
 * Space-separated terms are ANDed. fuzzysort matches a query as a subsequence, so a
 * single "chicken lemon" query would demand that literal order; splitting the terms and
 * intersecting the per-term result sets gives the "what's in my fridge" query for free.
 */
export function searchLibrary(index: Indexed[], query: string): Recipe[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return index.map((i) => i.recipe)

  let survivors: Map<Recipe, number> | null = null
  for (const term of terms) {
    // No score threshold: a subsequence match on junk scores no better than a real
    // typo ('spagetti' scores below 'zzzz'), so ranking, not cutting, is the lever.
    const hits = fuzzysort.go(term, index, { key: 'prepared', limit: 500 })
    const round = new Map<Recipe, number>()
    for (const hit of hits) round.set(hit.obj.recipe, hit.score)
    if (survivors === null) {
      survivors = round
    } else {
      const next = new Map<Recipe, number>()
      for (const [recipe, score] of survivors) {
        const other = round.get(recipe)
        if (other !== undefined) next.set(recipe, score + other)
      }
      survivors = next
    }
    if (survivors.size === 0) break
  }
  return [...(survivors ?? new Map())].sort((a, b) => b[1] - a[1]).map(([recipe]) => recipe)
}

export function ListPage({ route }: { route: Route }) {
  const { library, state, t, dispatch } = useApp()
  const [query, setQuery] = useQueryParam(route, 'q')

  const index = useMemo(() => buildIndex(library), [library])
  const results = useMemo(() => searchLibrary(index, query), [index, query])

  const createRecipe = () => {
    const taken = new Set(library.map((r) => r.id))
    const recipe = newRecipe(uniqueId('untitled', taken), state.prefs.lang)
    dispatch({ type: 'upsert', recipe })
    navigate(`/edit/${recipe.id}`)
  }

  return (
    <>
      <TopBar>
        <LangThemeControls />
        <button className="btn ghost" onClick={() => navigate('/settings')}>
          {t('list.settings')}
        </button>
        <button className="btn primary" onClick={createRecipe}>
          + {t('list.new')}
        </button>
      </TopBar>

      <div className="search-wrap">
        <input
          type="search"
          value={query}
          placeholder={t('list.search')}
          aria-label={t('list.search')}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="hint">{t('list.searchHint')}</p>

      {library.length === 0 ? (
        <p className="empty">{t('list.none')}</p>
      ) : results.length === 0 ? (
        <p className="empty">{t('list.empty')}</p>
      ) : (
        <div className="cards">
          {results.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </>
  )
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const { t, state } = useApp()
  const wait = criticalPath(recipe.nodes)
  const total = recipe.prepMinutes + wait
  const modified = isModifiedLocally(recipe.id, state.overlay)

  return (
    <button className="card" onClick={() => navigate(`/recipe/${recipe.id}`)}>
      <h3>{recipe.title}</h3>
      <div className="meta">
        {formatDuration(total)} · {t('recipe.serves', { n: recipe.servings })}
      </div>
      <div className="tags">
        <span className="badge lang">{recipe.lang.toUpperCase()}</span>
        {modified && <span className="badge">{t('list.modified')}</span>}
        {recipe.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </button>
  )
}
