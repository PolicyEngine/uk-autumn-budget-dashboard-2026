import { POLICY_COLORS, REVENUE_RAISING_NAMES } from "../utils/policyConfig";
import "./GroupedLegend.css";

/**
 * A chart legend in two centred groups, "Raise revenue" and "Cost
 * revenue", then the net line. Pass it to Recharts' <Legend content={…} />.
 *
 * @param {{names: string[], netLabel?: string}} props - The measures drawn,
 *   in the dashboard's legend order, and the net line's label (if drawn)
 */
function GroupedLegend({ names, netLabel }) {
  const groups = [
    ["Raise revenue", names.filter((name) => REVENUE_RAISING_NAMES.has(name))],
    ["Cost revenue", names.filter((name) => !REVENUE_RAISING_NAMES.has(name))],
  ].filter(([, items]) => items.length > 0);
  return (
    <div className="grouped-legend">
      {groups.map(([heading, items]) => (
        <div key={heading} className="grouped-legend-group">
          <p className="grouped-legend-heading">{heading}</p>
          <ul className="grouped-legend-items">
            {items.map((name) => (
              <li key={name}>
                <span
                  className="grouped-legend-swatch"
                  style={{ background: POLICY_COLORS[name] }}
                  aria-hidden="true"
                />
                {name}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {netLabel && (
        <ul className="grouped-legend-items grouped-legend-net">
          <li>
            <span className="grouped-legend-line" aria-hidden="true" />
            {netLabel}
          </li>
        </ul>
      )}
    </div>
  );
}

export default GroupedLegend;
