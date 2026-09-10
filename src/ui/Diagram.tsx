import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import type { Lang, Recipe, RecipeNode } from '../model/types'
import { qtyText } from '../store/format'
import { solveLayout, transpose, type Cell, type Layout } from '../solver/layout'
import { formatDuration } from '../solver/time'
import type { Translate } from '../i18n'

export type Orientation = 'horizontal' | 'vertical'

/**
 * §3.2 — reordering happens here, on the render itself, rather than in a list beside
 * it: the thing being rearranged is the picture, so the picture is what you grab.
 * Horizontal only — in a transposed table the streams run as columns, and there are
 * no rows left to stack.
 */
export type DiagramEdit = {
  /** Row ids in render order; index i is table row i. */
  rowIds: string[]
  /** Rows of the selected node's branch — they drag as one block. */
  selectedRows: Set<string>
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  /** `at` is a gap index into the current order: 0 is above the first row. */
  onMoveRows: (rowIds: string[], at: number) => void
  /** Timestamp of the last refused drop, bumped to replay the shake. */
  rejectedAt: number
}

type Props = {
  recipe: Recipe
  multiplier: number
  lang: Lang
  t: Translate
  orientation: Orientation
  /** §4.3 — done state is in memory only; a refresh clears it. */
  done?: Set<string>
  onToggleDone?: (nodeId: string) => void
  onOpenRef?: (recipeId: string) => void
  knownRecipeIds?: Set<string>
  edit?: DiagramEdit
}

export function useLayout(recipe: Recipe, orientation: Orientation): Layout {
  const solved = useMemo(() => solveLayout(recipe), [recipe])
  return useMemo(
    () => (orientation === 'vertical' ? transpose(solved) : solved),
    [solved, orientation],
  )
}

export function Diagram(props: Props) {
  const { recipe, orientation } = props
  const layout = useLayout(recipe, orientation)
  const edit = orientation === 'horizontal' ? props.edit : undefined

  const rowCount = orientation === 'vertical' ? layout.colCount : layout.rows.length
  const byRow = useMemo(() => {
    const grid: Cell[][] = Array.from({ length: Math.max(1, rowCount) }, () => [])
    for (const cell of layout.cells) grid[cell.row]?.push(cell)
    for (const line of grid) line.sort((a, b) => a.col - b.col)
    return grid
  }, [layout, rowCount])

  const nodesById = useMemo(() => new Map(recipe.nodes.map((n) => [n.id, n])), [recipe.nodes])

  const scroll = useRef<HTMLDivElement>(null)
  // The block being dragged lives in a ref, not in state: `drop` fires on the same
  // element tree that `dragstart` set up, and reading the payload out of a state
  // closure loses it whenever the two land in one render pass.
  const dragged = useRef<string[] | null>(null)
  const [lifted, setLifted] = useState<string[] | null>(null)
  const [gap, setGap] = useState<{ at: number; y: number } | null>(null)

  // A refused drop announces itself by shaking: there is no new order to apply, so
  // nothing else on screen would change to say the drag was seen at all.
  const rejectedAt = edit?.rejectedAt ?? 0
  const [shake, setShake] = useState(false)
  useEffect(() => {
    if (!rejectedAt) return
    setShake(true)
    const timer = window.setTimeout(() => setShake(false), 480)
    return () => window.clearTimeout(timer)
  }, [rejectedAt])

  /**
   * The gap the pointer is nearest, as an index into the current order — 0 above the
   * first row, `rowIds.length` below the last. Gaps rather than target rows: it is the
   * only way to express "put this at the very top", and it makes the two ends the
   * easiest targets on the table rather than the two impossible ones.
   */
  const gapAt = (clientY: number): { at: number; y: number } | null => {
    const box = scroll.current
    const body = box?.querySelector('tbody')
    if (!box || !body) return null
    const top = box.getBoundingClientRect().top
    const rows = [...body.rows]
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return { at: i, y: r.top - top }
    }
    const last = rows[rows.length - 1]?.getBoundingClientRect()
    return { at: rows.length, y: last ? last.bottom - top : 0 }
  }

  /**
   * What a cell drags. A merged cell already spans exactly the rows it joins, so
   * grabbing it moves that whole merge; a selected step brings its full branch, which
   * is wider whenever an input had to be pulled in by reference.
   */
  const rowsOf = (cell: Cell): string[] => {
    if (!edit) return []
    if (cell.nodeId && cell.nodeId === edit.selectedNodeId) {
      return edit.rowIds.filter((r) => edit.selectedRows.has(r))
    }
    return edit.rowIds.slice(cell.row, cell.row + cell.rowSpan)
  }

  const onCellDragStart = (cell: Cell) => (e: ReactDragEvent) => {
    if (!edit) return
    // Firefox starts no drag at all without a payload.
    e.dataTransfer.setData('text/plain', cell.doneKey)
    e.dataTransfer.effectAllowed = 'move'
    dragged.current = rowsOf(cell)
    setLifted(dragged.current)
  }

  const endDrag = () => {
    dragged.current = null
    setLifted(null)
    setGap(null)
  }

  return (
    <div
      className={`diagram-scroll${edit ? ' editable' : ''}`}
      ref={scroll}
      onDragOver={
        edit
          ? (e) => {
              if (!dragged.current) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const next = gapAt(e.clientY)
              setGap((g) => (g && next && g.at === next.at ? g : next))
            }
          : undefined
      }
      onDrop={
        edit
          ? (e) => {
              e.preventDefault()
              const rows = dragged.current
              const target = gapAt(e.clientY)
              if (rows && target) edit.onMoveRows(rows, target.at)
              endDrag()
            }
          : undefined
      }
      onDragEnd={edit ? endDrag : undefined}
    >
      {gap && <div className="drop-line" style={{ top: gap.y }} aria-hidden="true" />}
      <table className={`diagram${edit ? ' editable' : ''}${shake ? ' shake' : ''}`}>
        <tbody>
          {byRow.map((line, i) => (
            <tr key={i}>
              {line.map((cell) => (
                <CellView
                  key={cell.key}
                  cell={cell}
                  node={nodesById.get(cell.nodeId ?? '')}
                  picked={!!edit && !!cell.nodeId && cell.nodeId === edit.selectedNodeId}
                  onPick={edit ? () => edit.onSelectNode(cell.nodeId ?? null) : undefined}
                  lifted={
                    !!lifted &&
                    !!edit &&
                    edit.rowIds
                      .slice(cell.row, cell.row + cell.rowSpan)
                      .every((r) => lifted.includes(r))
                  }
                  onCellDragStart={edit ? onCellDragStart(cell) : undefined}
                  {...props}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CellView({
  cell,
  node,
  multiplier,
  lang,
  t,
  done,
  onToggleDone,
  onOpenRef,
  knownRecipeIds,
  picked,
  onPick,
  lifted,
  onCellDragStart,
}: Props & {
  cell: Cell
  node?: RecipeNode
  picked?: boolean
  onPick?: () => void
  lifted?: boolean
  onCellDragStart?: (e: ReactDragEvent) => void
}) {
  const isDone = !!done?.has(cell.doneKey)
  // §4.3 — tap any node to mark it done, in the viewer. In the editor the same tap
  // picks out the step's branch instead; the two never coexist.
  const activate = onToggleDone ? () => onToggleDone(cell.doneKey) : onPick
  const clickable = !!activate

  return (
    <td
      className={`cell k-${cell.kind}${isDone ? ' done' : ''}${picked ? ' picked' : ''}${
        lifted ? ' lifted' : ''
      }`}
      rowSpan={cell.rowSpan}
      colSpan={cell.colSpan}
      draggable={!!onCellDragStart}
      onDragStart={onCellDragStart}
      onClick={activate}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'button' : undefined}
      aria-pressed={onToggleDone ? isDone : onPick ? !!picked : undefined}
      onKeyDown={
        activate
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }
          : undefined
      }
    >
      <span className="cell-main">
        {node?.type === 'ingredient' && qtyText(node, multiplier, lang) && (
          <span className="cell-qty">{qtyText(node, multiplier, lang)}</span>
        )}
        {cell.text}
      </span>

      {node?.type === 'wait' && node.minutes > 0 && (
        <span className="cell-sub">{formatDuration(node.minutes)}</span>
      )}

      {node?.type === 'ingredient' &&
        node.ref &&
        (knownRecipeIds?.has(node.ref) ? (
          <button
            type="button"
            className="subrecipe-link"
            onClick={(e) => {
              e.stopPropagation()
              onOpenRef?.(node.ref!)
            }}
          >
            {t('recipe.openRef')} →
          </button>
        ) : (
          // §2.2 — a reference to a missing recipe renders as a visible marker.
          <span className="subrecipe-missing">⚠ {t('recipe.missingRef')}</span>
        ))}

      {cell.refOut.map((r) => (
        <span className="cell-ref" key={`out-${r}`}>
          {r.includes('→') ? r : `→ ${r}`}
        </span>
      ))}
      {cell.refIn.map((r) => (
        <span className="cell-ref" key={`in-${r}`}>
          + {r}
        </span>
      ))}
    </td>
  )
}
