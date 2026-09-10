import { useEffect, useMemo, useRef, useState } from 'react'
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
  onMoveRows: (rowIds: string[], toIndex: number) => void
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

  // The block being dragged lives in a ref, not in state: `drop` fires on the same
  // element tree that `dragstart` set up, and reading the payload out of a state
  // closure loses it whenever the two land in one render pass.
  const dragged = useRef<string[] | null>(null)
  const [drag, setDrag] = useState<{ rows: string[]; over: number | null } | null>(null)

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

  /** Grabbing any row of the selected branch grabs the whole branch. */
  const rowsUnder = (i: number): string[] => {
    if (!edit) return []
    const id = edit.rowIds[i]
    return edit.selectedRows.has(id)
      ? edit.rowIds.filter((r) => edit.selectedRows.has(r))
      : [id]
  }

  return (
    <div className="diagram-scroll">
      <table className={`diagram${edit ? ' editable' : ''}${shake ? ' shake' : ''}`}>
        <tbody>
          {byRow.map((line, i) => (
            <tr key={i}>
              {edit && (
                <td
                  className={[
                    'row-grip',
                    edit.selectedRows.has(edit.rowIds[i]) ? 'sel' : '',
                    drag?.over === i ? 'over' : '',
                    drag?.rows.includes(edit.rowIds[i]) ? 'lifted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  aria-label={edit.rowIds[i]}
                  onDragStart={(e) => {
                    // Firefox starts no drag at all without a payload.
                    e.dataTransfer.setData('text/plain', edit.rowIds[i])
                    dragged.current = rowsUnder(i)
                    setDrag({ rows: dragged.current, over: null })
                  }}
                  onDragEnd={() => {
                    dragged.current = null
                    setDrag(null)
                  }}
                  onDragOver={(e) => {
                    if (!dragged.current) return
                    e.preventDefault()
                    setDrag((d) => (d && d.over !== i ? { ...d, over: i } : d))
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragged.current) edit.onMoveRows(dragged.current, i)
                    dragged.current = null
                    setDrag(null)
                  }}
                >
                  ⠿
                </td>
              )}
              {line.map((cell) => (
                <CellView
                  key={cell.key}
                  cell={cell}
                  node={nodesById.get(cell.nodeId ?? '')}
                  picked={!!edit && !!cell.nodeId && cell.nodeId === edit.selectedNodeId}
                  onPick={edit ? () => edit.onSelectNode(cell.nodeId ?? null) : undefined}
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
}: Props & { cell: Cell; node?: RecipeNode; picked?: boolean; onPick?: () => void }) {
  const isDone = !!done?.has(cell.doneKey)
  // §4.3 — tap any node to mark it done, in the viewer. In the editor the same tap
  // picks out the step's branch instead; the two never coexist.
  const activate = onToggleDone ? () => onToggleDone(cell.doneKey) : onPick
  const clickable = !!activate

  return (
    <td
      className={`cell k-${cell.kind}${isDone ? ' done' : ''}${picked ? ' picked' : ''}`}
      rowSpan={cell.rowSpan}
      colSpan={cell.colSpan}
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
