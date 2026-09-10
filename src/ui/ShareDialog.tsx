import { useCallback, useEffect, useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import type { Recipe } from '../model/types'
import { useApp } from '../store/app'
import { criticalPath, formatDuration } from '../solver/time'
import { Diagram, type Orientation } from './Diagram'
import { formatServings } from '../store/format'
import { rasterScale } from './rasterScale'

type Props = {
  recipe: Recipe
  multiplier: number
  servings: number
  orientation: Orientation
  onClose: () => void
}

/** §5 — the diagram is cloned into an offscreen container at full size, unclipped. */
export function ShareDialog({ recipe, multiplier, servings, orientation, onClose }: Props) {
  const { t, lang, theme } = useApp()
  const [shareTheme, setShareTheme] = useState<'light' | 'dark'>(theme)
  const [shareOrientation, setShareOrientation] = useState<Orientation>(orientation)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'rendering' | 'ready' | 'failed'>('rendering')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by Retry — the render is an effect, so this is what re-runs it. */
  const [attempt, setAttempt] = useState(0)
  const stage = useRef<HTMLDivElement>(null)

  const filename = `${recipe.id}.png`

  // Rasterise as soon as the options change, never inside the gesture handler: on iOS
  // an await can lose the user gesture and the share sheet fails silently (§5).
  useEffect(() => {
    let cancelled = false
    setStatus('rendering')
    setBlob(null)
    setError(null)
    setMessage(null)
    const node = stage.current
    if (!node) return
    // A beat of grace: the stage has just been given a new theme class and a new
    // orientation, and measuring it before the browser has laid that out renders the
    // previous size.
    const id = window.setTimeout(() => {
      const width = node.scrollWidth
      const height = node.scrollHeight
      toBlob(node, {
        pixelRatio: rasterScale(width, height),
        width,
        height,
        backgroundColor: shareTheme === 'dark' ? '#12100e' : '#faf7f2',
        // Every face in the stack is a system font, so there is no @font-face to
        // inline. Measured, this saves no time — but left on, the rasteriser walks
        // the stylesheets looking for one, and a webfont added later would send it to
        // the network mid-render, which on a cold PWA start is a render that hangs.
        skipFonts: true,
      })
        .then((result) => {
          if (cancelled) return
          setBlob(result)
          setStatus(result ? 'ready' : 'failed')
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : String(err))
          setStatus('failed')
        })
    }, 60)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [shareTheme, shareOrientation, recipe, multiplier, attempt])

  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  const download = useCallback(() => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [url, filename])

  const copy = useCallback(async () => {
    if (!blob) return false
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setMessage(t('share.copied'))
      return true
    } catch {
      return false
    }
  }, [blob, t])

  /** Delivery, in order: native share sheet → clipboard → download (§5). */
  const share = useCallback(async () => {
    if (!blob) return
    const file = new File([blob], filename, { type: 'image/png' })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: recipe.title })
        return
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return
      }
    }
    if (await copy()) return
    download()
    setMessage(t('share.failed'))
  }, [blob, copy, download, filename, recipe.title, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const wait = criticalPath(recipe.nodes)

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t('share.title')}</h2>

        <div className="row" style={{ marginBottom: 10 }}>
          <div className="seg" role="group" aria-label={t('recipe.orientation')}>
            {(['horizontal', 'vertical'] as const).map((o) => (
              <button
                key={o}
                className="btn small"
                aria-pressed={shareOrientation === o}
                onClick={() => setShareOrientation(o)}
              >
                {t(`recipe.${o}`)}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={t('share.theme')}>
            {(['light', 'dark'] as const).map((th) => (
              <button
                key={th}
                className="btn small"
                aria-pressed={shareTheme === th}
                onClick={() => setShareTheme(th)}
              >
                {t(`app.theme.${th}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <button className="btn primary" onClick={share} disabled={!blob}>
            {t('share.share')}
          </button>
          <button className="btn" onClick={copy} disabled={!blob}>
            {t('share.copy')}
          </button>
          <button className="btn" onClick={download} disabled={!url}>
            {t('share.download')}
          </button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>

        {message && <p className="hint">{message}</p>}

        {/* Final fallback for delivery: the rendered PNG is on screen the whole time,
            so it can always be long-pressed or right-clicked out of the page. */}
        <div className="preview">
          {url && <img className="preview-img" src={url} alt={recipe.title} />}
          {status === 'rendering' && (
            <div className="preview-state" role="status">
              <span className="spinner" aria-hidden="true" />
              {t('share.rendering')}
            </div>
          )}
          {status === 'failed' && (
            <div className="preview-state failed" role="alert">
              <p>{t('share.renderFailed')}</p>
              {error && <p className="preview-why">{error}</p>}
              <button className="btn small" onClick={() => setAttempt((a) => a + 1)}>
                {t('share.retry')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Offscreen full-size render. Not a screenshot of the viewport.
          The holder does the offscreen positioning, never the captured node: the
          rasteriser copies computed styles onto its clone, and a cloned
          position:fixed/left:-20000px would push the whole render out of the
          output image. */}
      <div className="share-holder" aria-hidden="true">
        <div ref={stage} className={`share-stage theme-${shareTheme}`} data-theme={shareTheme}>
          <div className="share-head">
            <h1>{recipe.title}</h1>
            <div className="time">
              {t('recipe.prep', { prep: formatDuration(recipe.prepMinutes) })}
              {' + '}
              {t('recipe.wait', { wait: formatDuration(wait) })} ={' '}
              <b>{formatDuration(recipe.prepMinutes + wait)}</b>
              {' · '}
              {t('recipe.serves', { n: formatServings(servings, lang) })}
            </div>
            {recipe.note && <div className="note">{recipe.note}</div>}
          </div>
          <Diagram
            recipe={recipe}
            multiplier={multiplier}
            lang={lang}
            t={t}
            orientation={shareOrientation}
          />
          <div className="brandmark">gaditor</div>
        </div>
      </div>
    </div>
  )
}
