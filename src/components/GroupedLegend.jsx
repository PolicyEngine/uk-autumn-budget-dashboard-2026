import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import "./GroupedLegend.css";


// The groups' names: by the Government's revenue (Revenue impact), or by
// households' incomes (every chart of household income), where a measure
// that raises revenue lowers incomes
const GROUP_NAMES = {
  revenue: ["Raises revenue", "Costs revenue"],
  household: ["Lowers household incomes", "Raises household incomes"],
};

/**
 * Split legend items into the two groups, revenue-raising measures first,
 * keeping their order; empty groups are left out. Items that are not
 * policies (no `raises`) form one group with no name.
 *
 * @param {Array<{label: string, color: string, raises?: boolean}>} items
 * @param {"revenue"|"household"} [framing]
 */
export function legendGroups(items, framing = "revenue") {
  if (items.length > 0 && items.every((item) => item.raises === undefined)) {
    return [[null, items]];
  }
  const [raising, costing] = GROUP_NAMES[framing];
  return [
    [raising, items.filter((item) => item.raises)],
    [costing, items.filter((item) => !item.raises)],
  ].filter(([, groupItems]) => groupItems.length > 0);
}

/** The dashboard's policy names as legend items, coloured as in the charts. */
export const policyItems = (names) =>
  names.map((name) => ({
    label: name,
    color: POLICY_COLORS[name],
    raises: REVENUE_RAISING_NAMES.has(name),
  }));

/** A legend key: a square, or a short line (dashed when `dash` is set). */
function Swatch({ item }) {
  if (item.type === "line") {
    return (
      <svg
        className="grouped-legend-swatch-line"
        width="20"
        height="10"
        viewBox="0 0 20 10"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="5"
          x2="20"
          y2="5"
          stroke={item.color}
          strokeWidth="2.5"
          strokeDasharray={item.dash}
        />
      </svg>
    );
  }
  return (
    <span
      className="grouped-legend-swatch"
      style={{ background: item.color }}
      aria-hidden="true"
    />
  );
}

/**
 * A chart legend in a flowing grid across the card's width (as many
 * columns as fit, two or one on a phone): each group's name as a small tag
 * at the start of its run of items, the net line as the last item. A
 * short legend with no groups (before / after) is one centred row.
 *
 * Pass `names` (dashboard policy names) or `items`. `framing` names the
 * groups by revenue (Revenue impact) or by household incomes.
 */
function GroupedLegend({ names, items, netLabel, framing = "revenue" }) {
  const all = items ?? policyItems(names ?? []);
  const groups = legendGroups(all, framing);
  const flat = groups.length === 1 && !groups[0][0] && all.length <= 4;
  const entry = (item) => (
    <li key={item.label} className="grouped-legend-item" title={item.title ?? item.label}>
      <Swatch item={item} />
      <span className="grouped-legend-label">{item.short ?? item.label}</span>
    </li>
  );
  const net = netLabel && (
    <li className="grouped-legend-item">
      <span className="grouped-legend-line" aria-hidden="true" />
      <span className="grouped-legend-label">{netLabel}</span>
    </li>
  );
  if (flat) {
    return (
      <div className="grouped-legend is-flat">
        <ul className="grouped-legend-items">
          {all.map(entry)}
          {net}
        </ul>
      </div>
    );
  }
  return (
    <div className="grouped-legend is-flow">
      <ul className="grouped-legend-grid">
        {/* In group order, so the colours cluster, but no group names:
            one plain grid of swatch and name */}
        {groups.flatMap(([heading, groupItems]) =>
          groupItems.map((item) => (heading ? { ...item, title: `${item.label} (${heading.toLowerCase()})` } : item)).map(entry),
        )}
        {net}
      </ul>
    </div>
  );
}

export default GroupedLegend;
