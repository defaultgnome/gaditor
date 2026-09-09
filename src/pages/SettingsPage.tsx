import { useRef, useState } from 'react'
import { useApp } from '../store/app'
import { LangThemeControls, TopBar } from '../ui/TopBar'
import { downloadText, exportBundle, parseImport } from '../store/storage'

export function SettingsPage() {
  const { library, state, dispatch, t } = useApp()
  const [text, setText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // A deletion is a local change too, so tombstones count — otherwise deleting a
  // published recipe leaves 'revert all' disabled and the deletion unrecoverable here.
  const localCount = Object.keys(state.overlay.recipes).length + state.overlay.tombstones.length

  const runImport = (raw: string) => {
    const recipes = parseImport(raw)
    if (!recipes || recipes.length === 0) {
      setMessage(t('settings.importBad'))
      return
    }
    dispatch({ type: 'importRecipes', recipes })
    setMessage(t('settings.importOk', { n: recipes.length }))
    setText('')
  }

  return (
    <>
      <TopBar back="/">
        <LangThemeControls />
      </TopBar>

      <h1>{t('settings.title')}</h1>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>{t('settings.storage')}</h2>
        <p className="hint">{t('settings.localCount', { n: localCount })}</p>
        <div className="row" style={{ marginTop: 10 }}>
          {/* §7.3 — the exact file to commit as the new recipes.json. */}
          <button
            className="btn primary"
            onClick={() => downloadText('recipes.json', exportBundle(library))}
          >
            {t('settings.exportBundle')}
          </button>
          <button
            className="btn"
            disabled={localCount === 0}
            onClick={() => {
              if (confirm(t('settings.confirmRevertAll'))) dispatch({ type: 'revertAll' })
            }}
          >
            {t('settings.revertAll')}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          {t('settings.exportBundleHint')}
        </p>
      </div>

      <div className="panel">
        <h2>{t('settings.import')}</h2>
        <p className="hint">{t('settings.importHint')}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "version": 1, "recipes": [ … ] }'
          style={{ marginTop: 8, minHeight: 140, fontFamily: 'var(--mono)', fontSize: 12 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => runImport(text)}
          >
            {t('settings.importDo')}
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            {t('settings.importFile')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) runImport(await file.text())
              e.target.value = ''
            }}
          />
        </div>
        {message && (
          <p className="hint" role="status" style={{ marginTop: 8 }}>
            {message}
          </p>
        )}
      </div>
    </>
  )
}
