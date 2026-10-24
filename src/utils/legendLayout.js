/**
 * The grouped legend's layout, shared by the on-screen legend
 * (GroupedLegend.jsx) and the SVG/PNG export (exportChartAsSvg.js), so the
 * two match.
 *
 * Each group ("Raise revenue", "Cost revenue") keeps its own heading and
 * its own column; the groups sit side by side. A group with more than
 * SPLIT_ABOVE items splits its items into two sub-columns under its one
 * heading, filled down then across. Labels wrap where a column is
 * narrower than the label. Of the layouts that fit, the one with the
 * fewest lines wins (on a tie, the split one):
 *
 * - "split": the groups side by side, a long group in two sub-columns;
 * - "columns": the groups side by side, one column each;
 * - "stacked": one column, the groups one under the other (a phone).
 */

// A group with more items than this splits into two sub-columns
export const SPLIT_ABOVE = 3;
// Between groups, and between a group's two sub-columns (as in
// GroupedLegend.css)
export const GROUP_GAP = 32;
export const SUB_GAP = 20;
// Narrower than this, the legend is one column
export const STACK_BELOW = 400;
// A label is never wrapped narrower than this
export const MIN_LABEL_WIDTH = 120;

/** Word-wrap a label to `width` with `measure`; at least one line. */
export function wrapLabel(label, width, measure) {
  const lines = [];
  let line = "";
  for (const word of String(label).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** A group's items as sub-columns, filled down then across. */
export function subColumns(items, columns) {
  const rows = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    items.slice(index * rows, (index + 1) * rows),
  ).filter((column) => column.length > 0);
}

/**
 * The widest cap at which the columns fit: each group's columns are as
 * wide as its widest item, or the cap if narrower.
 */
function fittedCap(naturals, counts, available, gaps) {
  const total = (cap) =>
    naturals.reduce((sum, natural, index) => sum + Math.min(natural, cap) * counts[index], 0) +
    gaps;
  const widest = Math.max(0, ...naturals);
  if (total(widest) <= available) return widest;
  let low = 0;
  let high = widest;
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (total(middle) <= available) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Choose the layout.
 *
 * @param {object} options
 * @param {Array<{heading: ?string, labels: string[]}>} options.groups
 * @param {number} options.available - The width the legend may take
 * @param {(text: string) => number} options.measure - A label's width
 * @param {(text: string) => number} [options.measureHeading] - A heading's
 * @param {number} options.iconWidth - The swatch and its gap
 * @returns {{mode: string, groups: Array<{columns: number, width: number,
 *   lines: number[][]}>, lines: number, width: number}} Per group: its
 *   sub-column count, each sub-column's width (swatch included), and each
 *   sub-column's items' line counts; the legend's total lines (its tallest
 *   group) and width.
 */
export function legendLayout({
  groups,
  available,
  measure,
  measureHeading = measure,
  iconWidth,
}) {
  const naturals = groups.map(({ heading, labels }) =>
    Math.ceil(
      Math.max(
        heading ? measureHeading(heading) : 0,
        ...labels.map((label) => iconWidth + measure(label)),
      ),
    ),
  );
  const build = (mode, counts, cap) => {
    const laid = groups.map(({ labels }, index) => {
      const width = Math.min(naturals[index], cap);
      const lines = subColumns(labels, counts[index]).map((column) =>
        column.map(
          (label) => wrapLabel(label, Math.max(1, width - iconWidth), measure).length,
        ),
      );
      return { columns: counts[index], width, lines };
    });
    // Each row of a group is as tall as its tallest item
    const groupLines = laid.map(({ lines }) => {
      const rows = Math.max(0, ...lines.map((column) => column.length));
      let sum = 0;
      for (let row = 0; row < rows; row += 1) {
        sum += Math.max(1, ...lines.map((column) => column[row] ?? 0));
      }
      return sum;
    });
    const sideBySide = mode !== "stacked";
    const width = sideBySide
      ? laid.reduce(
          (sum, group) => sum + group.width * group.columns + SUB_GAP * (group.columns - 1),
          0,
        ) +
        GROUP_GAP * (laid.length - 1)
      : Math.max(0, ...laid.map((group) => group.width));
    return {
      mode,
      groups: laid,
      lines: sideBySide
        ? Math.max(0, ...groupLines)
        : groupLines.reduce((sum, lines) => sum + lines, 0),
      width,
    };
  };

  const candidates = [];
  if (available >= STACK_BELOW && groups.length > 0) {
    const tries = [
      ["split", groups.map(({ labels }) => (labels.length > SPLIT_ABOVE ? 2 : 1))],
      ["columns", groups.map(() => 1)],
    ];
    for (const [mode, counts] of tries) {
      if (mode === "split" && counts.every((count) => count === 1)) continue;
      const gaps =
        GROUP_GAP * (groups.length - 1) +
        counts.reduce((sum, count) => sum + SUB_GAP * (count - 1), 0);
      const cap = fittedCap(naturals, counts, available, gaps);
      const narrowest = Math.min(...naturals.map((natural) => Math.min(natural, cap)));
      if (narrowest - iconWidth < Math.min(MIN_LABEL_WIDTH, ...naturals.map((n) => n - iconWidth)))
        continue;
      candidates.push(build(mode, counts, cap));
    }
  }
  if (candidates.length === 0) {
    return build(
      "stacked",
      groups.map(() => 1),
      Math.max(iconWidth + 1, available),
    );
  }
  // Fewest lines; on a tie, the first (split before columns)
  return candidates.reduce((best, candidate) =>
    candidate.lines < best.lines ? candidate : best,
  );
}
