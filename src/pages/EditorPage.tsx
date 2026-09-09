import { useCallback, useMemo, useState } from 'react'
import type { Lang, Recipe, RecipeNode } from '../model/types'
import { useApp } from '../store/app'
import { navigate } from '../store/router'
import { newNode } from '../model/factory'
import { solveLayout } from '../solver/layout'
import { Diagram } from '../ui/Diagram'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { GraphCanvas } from './GraphCanvas'
import { useEditorDraft } from './useEditorDraft'
import { downloadText, exportRecipe } from '../store/storage'

export function EditorPage({ id }: { id: string }) {
  const { library, dispatch, t, lang } = useApp()
  const stored = library.find((r) => r.id === id)
  const [selected, setSelected] = useState<string | null>(null)
  const [cycleWarning, setCycleWarning] = useState(false)
  const [dragRow, setDragRow] = useState<number | null>(null)

  const persist = useCallback(
    (r: Recipe) => dispatch({ type: 'upsert', recipe: r }),
    [dispatch],
  )
  const { draft, update, undo, redo, canUndo, canRedo, saveState } = useEditorDraft(
    stored ?? EMPTY,
    persist,
  )

  const layout = useMemo(() => solveLayout(draft), [draft])
  const selectedNode = draft.nodes.find((n) => n.id === selected) ?? null

  if (!stored) {
    return (
      <>
        <TopBar back="/" />
        <p className="empty">{t('recipe.notFound')}</p>
      </>
    )
  }

  const patchNode = (nodeId: string, patch: Partial<RecipeNode>) =>
    update((r) => ({
      ...r,
      nodes: r.nodes.map((n) => (n.id === nodeId ? ({ ...n, ...patch } as RecipeNode) : n)),
    }))

  const addNode = (type: RecipeNode['type']) => {
    const node = newNode(type)
    update((r) => ({ ...r, nodes: [...r.nodes, node] }))
    setSelected(node.id)
  }

  const deleteNodes = (ids: string[]) => {
    const gone = new Set(ids)
    update((r) => ({
      ...r,
      nodes: r.nodes
        .filter((n) => !gone.has(n.id))
        .map((n) => ({ ...n, inputs: n.inputs.filter((i) => !gone.has(i)) })),
      rowOrder: r.rowOrder.filter((rowId) => !gone.has(rowId.split('#')[0])),
    }))
    setSelected((s) => (s && gone.has(s) ? null : s))
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

  /** §3.2 — row reordering happens in the solved-render pane and writes to rowOrder. */
  const moveRow = (index: number, delta: number) => {
    const current = layout.rows.map((r) => r.id)
    const target = index + delta
    if (target < 0 || target >= current.length) return
    const next = [...current]
    ;[next[index], next[target]] = [next[target], next[index]]
    update((r) => ({ ...r, rowOrder: next }))
  }

  const dropRow = (target: number) => {
    const from = dragRow
    setDragRow(null)
    if (from === null || from === target) return
    const next = layout.rows.map((r) => r.id)
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    update((r) => ({ ...r, rowOrder: next }))
  }

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
            onCycleBlocked={() => setCycleWarning(true)}
          />

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>{t('editor.preview')}</h2>
            <Diagram recipe={draft} multiplier={1} lang={lang} t={t} orientation="horizontal" />
            <p className="hint" style={{ marginTop: 10 }}>
              {t('editor.rowOrderHint')}
            </p>
            <ul className="roworder">
              {layout.rows.map((row, i) => {
                const node = draft.nodes.find((n) => n.id === row.sourceNodeId)
                const name =
                  row.kind === 'portion'
                    ? `${row.label} — ${node && node.type === 'split' ? 'split' : ''}`
                    : node && node.type === 'ingredient'
                      ? node.name
                      : row.sourceNodeId
                return (
                  <li
                    key={row.id}
                    draggable
                    onDragStart={() => setDragRow(i)}
                    onDragEnd={() => setDragRow(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropRow(i)
                    }}
                    className={dragRow === i ? 'dragging' : undefined}
                  >
                    <span className="grip" aria-hidden="true">
                      ⠿
                    </span>
                    <span>{name}</span>
                    <button
                      className="btn small ghost"
                      aria-label={t('editor.rowUp')}
                      disabled={i === 0}
                      onClick={() => moveRow(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="btn small ghost"
                      aria-label={t('editor.rowDown')}
                      disabled={i === layout.rows.length - 1}
                      onClick={() => moveRow(i, 1)}
                    >
                      ↓
                    </button>
                  </li>
                )
              })}
            </ul>
            {draft.rowOrder.length > 0 && (
              <button
                className="btn small"
                style={{ marginTop: 8 }}
                onClick={() => update((r) => ({ ...r, rowOrder: [] }))}
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
            <label className="field">
              <span>{t('editor.tags')}</span>
              <input
                type="text"
                value={draft.tags.join(', ')}
                onChange={(e) =>
                  update((r) => ({
                    ...r,
                    tags: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t('editor.noteField')}</span>
              <textarea
                value={draft.note ?? ''}
                onChange={(e) => update((r) => ({ ...r, note: e.target.value }))}
              />
            </label>
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>{selectedNode ? selectedNode.type : t('editor.selectNode')}</h2>
            {selectedNode && (
              <NodeInspector
                node={selectedNode}
                onChange={(patch) => patchNode(selectedNode.id, patch)}
                onDelete={() => deleteNodes([selectedNode.id])}
              />
            )}
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

function NodeInspector({
  node,
  onChange,
  onDelete,
}: {
  node: RecipeNode
  onChange: (patch: Partial<RecipeNode>) => void
  onDelete: () => void
}) {
  const { t } = useApp()
  return (
    <>
      {node.type === 'ingredient' && (
        <>
          <label className="field">
            <span>{t('editor.name')}</span>
            <input
              type="text"
              value={node.name}
              onChange={(e) => onChange({ name: e.target.value } as Partial<RecipeNode>)}
            />
          </label>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>{t('editor.qty')}</span>
              <input
                type="number"
                step="any"
                value={node.qty ?? ''}
                onChange={(e) =>
                  onChange({
                    qty: e.target.value === '' ? undefined : Number(e.target.value),
                  } as Partial<RecipeNode>)
                }
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>{t('editor.unit')}</span>
              <input
                type="text"
                value={node.unit ?? ''}
                onChange={(e) => onChange({ unit: e.target.value } as Partial<RecipeNode>)}
              />
            </label>
          </div>
          <p className="hint">
            Leave quantity empty for things that do not scale — a pinch of salt, oil for frying.
          </p>
          <label className="field">
            <span>{t('editor.ref')}</span>
            <input
              type="text"
              value={node.ref ?? ''}
              onChange={(e) =>
                onChange({ ref: e.target.value || undefined } as Partial<RecipeNode>)
              }
            />
          </label>
        </>
      )}

      {node.type === 'action' && (
        <label className="field">
          <span>{t('editor.label')}</span>
          <input
            type="text"
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value } as Partial<RecipeNode>)}
          />
        </label>
      )}

      {node.type === 'wait' && (
        <>
          <label className="field">
            <span>{t('editor.label')}</span>
            <input
              type="text"
              value={node.label}
              onChange={(e) => onChange({ label: e.target.value } as Partial<RecipeNode>)}
            />
          </label>
          <label className="field">
            <span>{t('editor.minutes')}</span>
            <input
              type="number"
              min={0}
              value={node.minutes}
              onChange={(e) =>
                onChange({
                  minutes: Math.max(0, Number(e.target.value) || 0),
                } as Partial<RecipeNode>)
              }
            />
          </label>
        </>
      )}

      {node.type === 'split' && (
        <>
          <span className="hint">{t('editor.portions')}</span>
          {node.portions.map((p, i) => (
            <div className="row" key={i} style={{ marginTop: 6 }}>
              <input
                type="number"
                min={0}
                max={100}
                style={{ width: 90 }}
                value={p.percent}
                onChange={(e) => {
                  const portions = node.portions.map((q, j) =>
                    j === i ? { ...q, percent: Number(e.target.value) || 0 } : q,
                  )
                  onChange({ portions } as Partial<RecipeNode>)
                }}
              />
              <span className="hint">{i === 0 ? 'stays on row' : `→ new row`}</span>
              {node.portions.length > 2 && (
                <button
                  className="btn small ghost"
                  onClick={() =>
                    onChange({
                      portions: node.portions.filter((_, j) => j !== i),
                    } as Partial<RecipeNode>)
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            onClick={() =>
              onChange({
                portions: [...node.portions, { percent: 0, label: '' }],
              } as Partial<RecipeNode>)
            }
          >
            {t('editor.addPortion')}
          </button>
        </>
      )}

      <button className="btn small" style={{ marginTop: 12 }} onClick={onDelete}>
        {t('editor.deleteNode')}
      </button>
    </>
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
