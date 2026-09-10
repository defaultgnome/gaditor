import { lazy, Suspense, useMemo, useState } from 'react'
import { useApp } from '../store/app'
import { navigate } from '../store/router'
import { criticalPath, formatDuration } from '../solver/time'
import { Diagram, type Orientation } from '../ui/Diagram'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { useIsMobile } from '../ui/useIsMobile'
import { useWakeLock } from '../ui/useWakeLock'
import { isModifiedLocally } from '../store/storage'
import { formatServings } from '../store/format'

// The DOM-to-image library is only needed once you actually press Share.
const ShareDialog = lazy(() =>
  import('../ui/ShareDialog').then((m) => ({ default: m.ShareDialog })),
)

const PRESETS = [1, 2, 4, 6, 8]

export function RecipePage({ id }: { id: string }) {
  const { library, state, dispatch, t, lang } = useApp()
  const recipe = library.find((r) => r.id === id)

  // §4.3 / §4.4 — done marks and the multiplier are in memory only. A refresh clears
  // them; they are about this cooking session, not about the recipe.
  const isMobile = useIsMobile()
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const [servings, setServings] = useState<number | null>(null)
  // Defaults to vertical on mobile (a narrow screen reads a tall single column far
  // better than a wide horizontal table), but only as the initial value — once the
  // cook picks an orientation, resizing must not override their choice.
  const [orientation, setOrientation] = useState<Orientation>(() =>
    isMobile ? 'vertical' : 'horizontal',
  )
  const [sharing, setSharing] = useState(false)
  const wakeLock = useWakeLock()

  // A recipe may not reference itself (§2.2). Excluding its own id makes a self
  // reference render as the visible 'missing recipe' marker rather than a link that
  // goes nowhere.
  const knownIds = useMemo(
    () => new Set(library.map((r) => r.id).filter((rid) => rid !== id)),
    [library, id],
  )

  if (!recipe) {
    return (
      <>
        <TopBar back="/" />
        <p className="empty">{t('recipe.notFound')}</p>
      </>
    )
  }

  const effectiveServings = servings ?? recipe.servings
  const multiplier = recipe.servings > 0 ? effectiveServings / recipe.servings : 1
  const wait = criticalPath(recipe.nodes)
  const total = recipe.prepMinutes + wait
  const modified = isModifiedLocally(recipe.id, state.overlay)

  const toggleDone = (nodeId: string) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })

  return (
    <>
      <TopBar back="/">
        <LangThemeControls />
        <button className="btn" onClick={() => navigate(`/edit/${recipe.id}`)}>
          {t('recipe.edit')}
        </button>
        <button className="btn primary" onClick={() => setSharing(true)}>
          {t('recipe.share')}
        </button>
      </TopBar>

      <div className="recipe-head">
        <h1>{recipe.title}</h1>
        <div className="time">
          {t('recipe.prep', { prep: formatDuration(recipe.prepMinutes) })}
          {' + '}
          {t('recipe.wait', { wait: formatDuration(wait) })} = <b>{formatDuration(total)}</b>
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
        {recipe.note && <div className="note">{recipe.note}</div>}
      </div>

      <div className="servings">
        <span className="hint">{t('recipe.servings')}</span>
        <div className="seg" role="group" aria-label={t('recipe.servings')}>
          {PRESETS.map((n) => (
            <button
              key={n}
              className="btn small"
              aria-pressed={effectiveServings === n}
              onClick={() => setServings(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0.25}
          step={0.25}
          value={effectiveServings}
          aria-label={t('recipe.servings')}
          onChange={(e) => {
            const v = Number(e.target.value)
            setServings(Number.isFinite(v) && v > 0 ? v : null)
          }}
        />
        <span className="hint">
          {t('recipe.serves', { n: formatServings(effectiveServings, lang) })}
        </span>
        {servings !== null && servings !== recipe.servings && (
          <button className="btn ghost small" onClick={() => setServings(null)}>
            {t('recipe.reset')}
          </button>
        )}
        <div className="spacer" />
        <div className="seg" role="group" aria-label={t('recipe.orientation')}>
          {(['horizontal', 'vertical'] as const).map((o) => (
            <button
              key={o}
              className="btn small"
              aria-pressed={orientation === o}
              onClick={() => setOrientation(o)}
            >
              {t(`recipe.${o}`)}
            </button>
          ))}
        </div>
        {wakeLock.supported && (
          <button
            className="btn small"
            aria-pressed={wakeLock.enabled}
            onClick={() => wakeLock.setEnabled(!wakeLock.enabled)}
          >
            ☀ {t('recipe.wakeLock')}
          </button>
        )}
      </div>

      <Diagram
        recipe={recipe}
        multiplier={multiplier}
        lang={lang}
        t={t}
        orientation={orientation}
        done={done}
        onToggleDone={toggleDone}
        knownRecipeIds={knownIds}
        onOpenRef={(refId) => navigate(`/recipe/${refId}`)}
      />

      {modified && (
        <p style={{ marginTop: 20 }}>
          <button
            className="btn small"
            onClick={() => {
              if (confirm(t('recipe.confirmRevert')))
                dispatch({ type: 'revert', id: recipe.id })
            }}
          >
            {t('recipe.revert')}
          </button>
        </p>
      )}

      {sharing && (
        <Suspense fallback={null}>
          <ShareDialog
            recipe={recipe}
            multiplier={multiplier}
            servings={effectiveServings}
            orientation={orientation}
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
    </>
  )
}
