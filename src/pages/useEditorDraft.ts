import { useCallback, useEffect, useRef, useState } from 'react'
import type { Recipe } from '../model/types'

const HISTORY_DEBOUNCE = 450
const AUTOSAVE_DEBOUNCE = 600
const HISTORY_LIMIT = 100

export type SaveState = 'idle' | 'saving' | 'saved'

/**
 * §6.2 — snapshot-based undo/redo on a debounced stack, plus debounced autosave.
 * React Flow provides no undo, and a node canvas without undo is unusable after one
 * mis-drag; losing a 20-node graph to a stray refresh is equally unacceptable.
 */
export function useEditorDraft(initial: Recipe, persist: (r: Recipe) => void) {
  const [draft, setDraft] = useState<Recipe>(initial)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const past = useRef<Recipe[]>([])
  const future = useRef<Recipe[]>([])
  const committed = useRef<Recipe>(initial)
  const historyTimer = useRef<number | undefined>(undefined)
  const saveTimer = useRef<number | undefined>(undefined)
  const skipHistory = useRef(false)
  // Merely opening the editor must not create a local overlay copy: nothing is
  // persisted until the author actually changes something.
  const dirty = useRef(false)
  const [, forceRender] = useState(0)

  // Adopt a different recipe (navigating between editors) without dragging the old
  // history along.
  const initialId = useRef(initial.id)
  useEffect(() => {
    if (initialId.current === initial.id) return
    initialId.current = initial.id
    past.current = []
    future.current = []
    committed.current = initial
    dirty.current = false
    setDraft(initial)
  }, [initial])

  const update = useCallback((fn: (r: Recipe) => Recipe) => {
    dirty.current = true
    setDraft((prev) => {
      const next = fn(prev)
      if (next === prev) return prev
      if (skipHistory.current) {
        skipHistory.current = false
      } else {
        window.clearTimeout(historyTimer.current)
        historyTimer.current = window.setTimeout(() => {
          past.current = [...past.current, committed.current].slice(-HISTORY_LIMIT)
          future.current = []
          committed.current = next
          forceRender((n) => n + 1)
        }, HISTORY_DEBOUNCE)
      }
      return next
    })
    setSaveState('saving')
  }, [])

  const undo = useCallback(() => {
    window.clearTimeout(historyTimer.current)
    const prev = past.current.at(-1)
    if (!prev) return
    past.current = past.current.slice(0, -1)
    future.current = [committed.current, ...future.current]
    committed.current = prev
    skipHistory.current = true
    setDraft(prev)
    setSaveState('saving')
    forceRender((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    window.clearTimeout(historyTimer.current)
    const next = future.current[0]
    if (!next) return
    future.current = future.current.slice(1)
    past.current = [...past.current, committed.current]
    committed.current = next
    skipHistory.current = true
    setDraft(next)
    setSaveState('saving')
    forceRender((n) => n + 1)
  }, [])

  // Autosave — no explicit Save button (§6.2).
  useEffect(() => {
    if (!dirty.current) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      persist(draft)
      setSaveState('saved')
    }, AUTOSAVE_DEBOUNCE)
    return () => window.clearTimeout(saveTimer.current)
  }, [draft, persist])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return {
    draft,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
  }
}
