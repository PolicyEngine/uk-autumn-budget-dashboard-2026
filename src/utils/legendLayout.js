/**
 * The grouped chart legend's grid, shared by the on-screen legend
 * (GroupedLegend.jsx) and the exported one (createGroupedLegend), so the
 * two always match.
 *
 * Every group's heading spans the block; its items flow into the same
 * even columns, so the columns line up from one group to the next. The
 * column count is the one that gives the fewest rows in all; between
 * counts that tie, the fewer, wider columns win. A column may be a little
 * narrower than the widest item (that item's label then wraps onto a
 * second line), but no narrower than SHRINK of it.
 */

export const LEGEND_COLUMN_GAP = 24;
export const MAX_LEGEND_COLUMNS = 4;
const SHRINK = 0.8;

/**
 * @param {Object} options
 * @param {number} options.available - Width the legend may use, in px
 * @param {number} options.itemWidth - The widest item's natural width
 * @param {number[]} options.counts - Items in each group
 * @param {number} [options.gap] - Gap between columns
 * @returns {{columns: number, columnWidth: number, width: number}}
 */
export function legendGrid({
  available,
  itemWidth,
  counts,
  gap = LEGEND_COLUMN_GAP,
}) {
  const largest = Math.max(1, ...counts);
  let best = { columns: 1, rows: Infinity };
  for (let n = 1; n <= Math.min(MAX_LEGEND_COLUMNS, largest); n += 1) {
    const fits = n === 1 || n * itemWidth * SHRINK + (n - 1) * gap <= available;
    if (!fits) break;
    const rows = counts.reduce((sum, count) => sum + Math.ceil(count / n), 0);
    if (rows < best.rows) best = { columns: n, rows };
  }
  const { columns } = best;
  const columnWidth = Math.max(
    0,
    Math.min(itemWidth, (available - (columns - 1) * gap) / columns),
  );
  return {
    columns,
    columnWidth,
    width: columns * columnWidth + (columns - 1) * gap,
  };
}
