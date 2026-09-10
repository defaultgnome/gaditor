import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lang, Recipe, RecipeNode } from '../model/types'
import { useApp } from '../store/app'
import { navigate } from '../store/router'
import { cloneNode, newMixNode, newNode, nodeId } from '../model/factory'
import { cellText, solveLayout, type Layout } from '../solver/layout'
import { Diagram } from '../ui/Diagram'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { GraphCanvas, type Direction } from './GraphCanvas'
import { useEditorDraft } from './useEditorDraft'
import { downloadText, exportRecipe } from '../store/storage'

export function EditorPage({ id }: { id: string }) {
  const { library, dispatch, t, lang } = useApp()
  const stored = library.find((r) => r.id === id)
  const [selected, setSelected] = useState<string | null>(null)
  const [cycleWarning, setCycleWarning] = useState(false)
  /** Set when a drop was refused, so the table can shake and say which steps broke. */
  const [refused, setRefused] = useState<{ at: number; steps: string[] } | null>(null)

  const persist = useCallback(
    (r: Recipe) => dispatch({ type: 'upsert', recipe: r }),
    [dispatch],
  )
  const { draft, update, undo, redo, canUndo, canRedo, saveState } = useEditorDraft(
    stored ?? EMPTY,
    persist,
  )

  const layout = useMemo(() => solveLayout(draft), [draft])

  const patchNode = useCallback(
    (nodeId: string, patch: Partial<RecipeNode>) =>
      update((r) => ({
        ...r,
        nodes: r.nodes.map((n) => (n.id === nodeId ? ({ ...n, ...patch } as RecipeNode) : n)),
      })),
    [update],
  )

  const addNode = (type: RecipeNode['type']) => {
    const node = newNode(type)
    update((r) => ({ ...r, nodes: [...r.nodes, node] }))
    setSelected(node.id)
  }

  // Callbacks handed to the canvas must keep a stable identity — they sit in the node
  // context, so a new one on every keystroke re-renders every node on the canvas. A ref
  // gives them the current draft without taking it as a dependency.
  const draftRef = useRef(draft)
  draftRef.current = draft

  /**
   * The copy's id is minted outside `update`: React invokes a state updater twice under
   * StrictMode, and an id generated in there would differ between the two runs.
   */
  const duplicateNode = useCallback(
    (id: string): string | null => {
      const source = draftRef.current.nodes.find((n) => n.id === id)
      if (!source) return null
      const copy = cloneNode(source, nodeId(id.slice(0, 1)))
      update((r) => ({ ...r, nodes: [...r.nodes, copy] }))
      setSelected(copy.id)
      return copy.id
    },
    [update],
  )

  /** §6.2 — a connection dropped on empty canvas lands as a `mix` wired to its origin. */
  const spawnConnected = useCallback(
    (anchorId: string, direction: Direction): string | null => {
      const anchor = draftRef.current.nodes.find((n) => n.id === anchorId)
      if (!anchor) return null
      // Feeding an ingredient is meaningless — it is a source by definition (§2.2).
      if (direction === 'upstream' && anchor.type === 'ingredient') return null
      const spawned = newMixNode()
      update((r) =>
        direction === 'downstream'
          ? { ...r, nodes: [...r.nodes, { ...spawned, inputs: [anchorId] }] }
          : {
              ...r,
              nodes: [
                ...r.nodes.map((n) =>
                  n.id === anchorId ? { ...n, inputs: [...n.inputs, spawned.id] } : n,
                ),
                spawned,
              ],
            },
      )
      setSelected(spawned.id)
      return spawned.id
    },
    [update],
  )

  const deleteNodes = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids)
      update((r) => ({
        ...r,
        nodes: r.nodes
          .filter((n) => !gone.has(n.id))
          .map((n) => ({ ...n, inputs: n.inputs.filter((i) => !gone.has(i)) })),
        rowOrder: r.rowOrder.filter((rowId) => !gone.has(rowId.split('#')[0])),
      }))
      setSelected((s) => (s && gone.has(s) ? null : s))
    },
    [update],
  )

  if (!stored) {
    return (
      <>
        <TopBar back="/" />
        <p className="empty">{t('recipe.notFound')}</p>
      </>
    )
  }

  const connect = (from: string, to: string) =>
    update((r) => ({
      ...r,
      nodes: r.nodes.map((n) =>
        n.id === to && n.type !== 'ingredient' && !n.inputs.includes(from)
          ? { ...n, inputs: [...n.inputs, from] }
          : n,
      ),
    }))

  const disconnect = (from: string, to: string) =>
    update((r) => ({
      ...r,
      nodes: r.nodes.map((n) =>
        n.id === to ? { ...n, inputs: n.inputs.filter((i) => i !== from) } : n,
      ),
    }))

  /**
   * §3.2 — rows are dragged on the render itself and written straight to rowOrder,
   * which the solver then takes literally. A drag that would tear a merge apart is
   * refused rather than applied: the alternative is a row that visibly snaps back, or
   * a diagram that quietly falls apart into reference markers. Only a drag that makes
   * things *worse* is refused — a recipe whose merges already cannot all be contiguous
   * must still be rearrangeable.
   */
  const moveRows = (rowIds: string[], at: number) => {
    if (rowIds.length === 0) return
    const order = layout.rows.map((r) => r.id)
    const moving = new Set(rowIds)
    // `at` is a gap: everything above it stays above, everything below stays below.
    const above = order.slice(0, at).filter((id) => !moving.has(id))
    const below = order.slice(at).filter((id) => !moving.has(id))
    const next = [...above, ...rowIds, ...below]
    if (next.every((id, i) => id === order[i])) return

    const before = detachedIn(layout)
    const after = detachedIn(solveLayout({ ...draft, rowOrder: next }))
    if (after.length > before.length) {
      const broken = after.filter((id) => !before.includes(id))
      setRefused({
        at: Date.now(),
        // Quoted, because a step's own label routinely contains a comma — an
        // unquoted list of them reads as one long sentence.
        steps: broken.map((id) => {
          const node = draft.nodes.find((n) => n.id === id)
          return `“${node ? cellText(node) : id}”`
        }),
      })
      return
    }
    setRefused(null)
    update((r) => ({ ...r, rowOrder: next }))
  }

  const branchRows = new Set(selected ? (layout.nodeRows.get(selected) ?? []) : [])

  return (
    <>
      <TopBar back={`/recipe/${draft.id}`}>
        <LangThemeControls />
        {saveState !== 'idle' && (
          <span className="saved-chip">
            {saveState === 'saved' ? `✓ ${t('editor.saved')}` : t('editor.saving')}
          </span>
        )}
        <button className="btn small" disabled={!canUndo} onClick={undo}>
          ↶ {t('editor.undo')}
        </button>
        <button className="btn small" disabled={!canRedo} onClick={redo}>
          ↷ {t('editor.redo')}
        </button>
        <button className="btn primary" onClick={() => navigate(`/recipe/${draft.id}`)}>
          {t('editor.done')}
        </button>
      </TopBar>

      <div className="editor-grid">
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="hint">{t('editor.addNode')}</span>
            {(['ingredient', 'action', 'wait', 'split'] as const).map((type) => (
              <button key={type} className="btn small" onClick={() => addNode(type)}>
                + {t(`editor.add${type[0].toUpperCase()}${type.slice(1)}`)}
              </button>
            ))}
            <div className="spacer" />
            <button
              className="btn small"
              onClick={() => downloadText(`${draft.id}.json`, exportRecipe(draft))}
            >
              {t('settings.exportRecipe')}
            </button>
            <button
              className="btn small"
              onClick={() => {
                if (confirm(t('app.confirmDelete'))) {
                  dispatch({ type: 'remove', id: draft.id })
                  navigate('/')
                }
              }}
            >
              {t('app.delete')}
            </button>
          </div>

          {cycleWarning && (
            <p className="hint" role="alert" style={{ color: 'var(--warn)' }}>
              {t('editor.cycleBlocked')}
            </p>
          )}

          <GraphCanvas
            recipe={draft}
            selected={selected}
            onSelect={setSelected}
            onConnectNodes={(a, b) => {
              setCycleWarning(false)
              connect(a, b)
            }}
            onDisconnect={disconnect}
            onDeleteNodes={deleteNodes}
            onDuplicateNode={duplicateNode}
            onSpawnConnected={spawnConnected}
            onPatchNode={patchNode}
            onCycleBlocked={() => setCycleWarning(true)}
            warnings={layout.warnings}
          />

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>{t('editor.preview')}</h2>
            <Diagram
              recipe={draft}
              multiplier={1}
              lang={lang}
              t={t}
              orientation="horizontal"
              edit={{
                rowIds: layout.rows.map((r) => r.id),
                selectedRows: branchRows,
                selectedNodeId: selected,
                onSelectNode: (id) => setSelected((s) => (s === id ? null : id)),
                onMoveRows: moveRows,
                rejectedAt: refused?.at ?? 0,
              }}
            />
            <p
              className="hint"
              style={{ marginTop: 10, color: refused ? 'var(--warn)' : undefined }}
              role={refused ? 'alert' : undefined}
            >
              {refused
                ? t('editor.orderRefused', { steps: refused.steps.join(', ') })
                : t('editor.rowOrderHint')}
            </p>
            {draft.rowOrder.length > 0 && (
              <button
                className="btn small"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setRefused(null)
                  update((r) => ({ ...r, rowOrder: [] }))
                }}
              >
                {t('editor.resetRowOrder')}
              </button>
            )}
          </div>
        </div>

        <aside>
          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>{t('editor.title')}</h2>
            <label className="field">
              <span>{t('editor.recipeTitle')}</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => update((r) => ({ ...r, title: e.target.value }))}
              />
            </label>
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span>{t('editor.servingsBase')}</span>
                <input
                  type="number"
                  min={1}
                  value={draft.servings}
                  onChange={(e) =>
                    update((r) => ({
                      ...r,
                      servings: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>{t('editor.prepMinutes')}</span>
                <input
                  type="number"
                  min={0}
                  value={draft.prepMinutes}
                  onChange={(e) =>
                    update((r) => ({
                      ...r,
                      prepMinutes: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>{t('editor.lang')}</span>
              <select
                value={draft.lang}
                onChange={(e) => update((r) => ({ ...r, lang: e.target.value as Lang }))}
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </label>
            <TagsField
              label={t('editor.tags')}
              tags={draft.tags}
              onChange={(tags) => update((r) => ({ ...r, tags }))}
            />
            <label className="field">
              <span>{t('editor.noteField')}</span>
              <textarea
                value={draft.note ?? ''}
                onChange={(e) => update((r) => ({ ...r, note: e.target.value }))}
              />
            </label>
          </div>

          <div className="panel">
            <h2>
              {layout.warnings.length
                ? t('editor.warnings', { n: layout.warnings.length })
                : t('editor.noWarnings')}
            </h2>
            <ul className="warnings">
              {layout.warnings.map((w) => (
                <li key={w.kind}>
                  {t(`warn.${w.kind}`)} ({w.nodeIds.length})
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  )
}

/** Steps that had to pull an input in by reference instead of merging with it. */
function detachedIn(layout: Layout): string[] {
  return layout.warnings.find((w) => w.kind === 'detached')?.nodeIds ?? []
}

/** A tag is any text; only the comma separates one from the next. */
function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The box holds raw text, not the parsed list. Rendering `tags.join(', ')` back into a
 * controlled input made the field unusable: the comma and the space you type are not
 * part of any tag, so the next render deleted them again — which read as "the field
 * refuses every character except letters".
 */
function TagsField({
  label,
  tags,
  onChange,
}: {
  label: string
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [text, setText] = useState(() => tags.join(', '))

  // Adopt a change that came from somewhere else (undo, a different recipe) without
  // rewriting the box — and so without moving the caret — while it merely disagrees
  // about trailing punctuation.
  useEffect(() => {
    const mine = parseTags(text)
    if (mine.length !== tags.length || mine.some((tag, i) => tag !== tags[i])) {
      setText(tags.join(', '))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` is the thing being reconciled
  }, [tags])

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseTags(e.target.value))
        }}
      />
    </label>
  )
}

const EMPTY: Recipe = {
  version: 1,
  id: '',
  title: '',
  lang: 'en',
  servings: 1,
  prepMinutes: 0,
  tags: [],
  nodes: [],
  rowOrder: [],
}
