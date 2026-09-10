import { useMemo } from 'react'
import type { Lang, Recipe, RecipeNode } from '../model/types'
import { qtyText } from '../store/format'
import { solveLayout, transpose, type Cell, type Layout } from '../solver/layout'
import { formatDuration } from '../solver/time'
import type { Translate } from '../i18n'

export type Orientation = 'horizontal' | 'vertical'

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

  const rowCount = orientation === 'vertical' ? layout.colCount : layout.rows.length
  const byRow = useMemo(() => {
    const grid: Cell[][] = Array.from({ length: Math.max(1, rowCount) }, () => [])
    for (const cell of layout.cells) grid[cell.row]?.push(cell)
    for (const line of grid) line.sort((a, b) => a.col - b.col)
    return grid
  }, [layout, rowCount])

  const nodesById = useMemo(() => new Map(recipe.nodes.map((n) => [n.id, n])), [recipe.nodes])

  return (
    <div className="diagram-scroll">
      <table className="diagram">
        <tbody>
          {byRow.map((line, i) => (
            <tr key={i}>
              {line.map((cell) => (
                <CellView
                  key={cell.key}
                  cell={cell}
                  node={nodesById.get(cell.nodeId ?? '')}
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
}: Props & { cell: Cell; node?: RecipeNode }) {
  const isDone = !!done?.has(cell.doneKey)
  const clickable = !!onToggleDone

  return (
    <td
      className={`cell k-${cell.kind}${isDone ? ' done' : ''}`}
      rowSpan={cell.rowSpan}
      colSpan={cell.colSpan}
      // §4.3 — tap any node to mark it done. Applies to every node type.
      onClick={clickable ? () => onToggleDone!(cell.doneKey) : undefined}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'button' : undefined}
      aria-pressed={clickable ? isDone : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggleDone!(cell.doneKey)
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
