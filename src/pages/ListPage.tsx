import { useMemo, type ReactNode } from 'react'
import { buildIndex, markKey, searchLibrary, type SearchHit } from '../model/search'
import { useApp } from '../store/app'
import { navigate, useQueryParam, type Route } from '../store/router'
import { criticalPath, formatDuration } from '../solver/time'
import { isModifiedLocally, uniqueId } from '../store/storage'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { newRecipe } from '../model/factory'

/** Renders `text` with the matched runs wrapped in <mark>. */
export function Highlight({ text, marks }: { text: string; marks?: Set<number> }) {
  if (!marks || marks.size === 0) return <>{text}</>
  const out: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    const on = marks.has(i)
    let j = i + 1
    while (j < text.length && marks.has(j) === on) j++
    const chunk = text.slice(i, j)
    out.push(on ? <mark key={i}>{chunk}</mark> : <span key={i}>{chunk}</span>)
    i = j
  }
  return <>{out}</>
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
          {results.map((hit) => (
            <RecipeCard key={hit.recipe.id} hit={hit} />
          ))}
        </div>
      )}
    </>
  )
}

function RecipeCard({ hit }: { hit: SearchHit }) {
  const { t, state } = useApp()
  const { recipe, marks } = hit
  const wait = criticalPath(recipe.nodes)
  const total = recipe.prepMinutes + wait
  const modified = isModifiedLocally(recipe.id, state.overlay)

  // The ingredient list is not on the card, so a match there is invisible unless the
  // matched ingredients are pulled up. This is the whole "why am I seeing this" answer.
  const matchedIngredients = recipe.nodes
    .filter((n) => n.type === 'ingredient' && marks.has(markKey('ingredient', n.name)))
    .map((n) => (n.type === 'ingredient' ? n.name : ''))
    .filter((name, i, all) => all.indexOf(name) === i)

  return (
    <button className="card" onClick={() => navigate(`/recipe/${recipe.id}`)}>
      <h3>
        <Highlight text={recipe.title} marks={marks.get(markKey('title', recipe.title))} />
      </h3>
      <div className="meta">
        {formatDuration(total)} · {t('recipe.serves', { n: recipe.servings })}
      </div>
      {matchedIngredients.length > 0 && (
        <div className="matched">
          {matchedIngredients.map((name) => (
            <span key={name}>
              <Highlight text={name} marks={marks.get(markKey('ingredient', name))} />
            </span>
          ))}
        </div>
      )}
      <div className="tags">
        <span className="badge lang">{recipe.lang.toUpperCase()}</span>
        {modified && <span className="badge">{t('list.modified')}</span>}
        {recipe.tags.map((tag) => (
          <span className="tag" key={tag}>
            <Highlight text={tag} marks={marks.get(markKey('tag', tag))} />
          </span>
        ))}
      </div>
    </button>
  )
}
