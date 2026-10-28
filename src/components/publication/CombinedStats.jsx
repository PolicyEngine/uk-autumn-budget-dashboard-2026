import { provisionalLabel } from "../../utils/publication/manifest";
import {
  fiscalYearLabel,
  formatPercent,
  formatPoints,
  formatRelative,
} from "../../utils/publication/format";
import UnavailableNotice from "./UnavailableNotice";
import "./publication.css";

function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Headline statistics for the selected measures, from `combinedStats`.
 *
 * Poverty is the absolute poverty rate before housing costs (policyengine-uk's
 * `in_poverty_bhc`), the measure the national calculator reports.
 *
 * The provisional label is the manifest's (provisionalLabel): candidates
 * before the Budget, statement figures from Budget day.
 *
 * @param {{stats: Object, measureNames?: Object<string, string>,
 *   manifest?: Object|null}} props
 */
function CombinedStats({ stats, measureNames = {}, manifest = null }) {
  const name = (id) => measureNames[id] ?? id;
  if (stats.status !== "available") {
    const sets = stats.availableSets ?? [];
    return (
      <UnavailableNotice reason="Combined figures are unavailable for this selection.">
        <p className="publication-unavailable-detail">{stats.reason}.</p>
        {sets.length > 0 && (
          <p className="publication-unavailable-detail">
            Combined runs are published for:{" "}
            {sets.map((ids) => joinNames(ids.map(name))).join("; ")}.
          </p>
        )}
      </UnavailableNotice>
    );
  }
  // null: withheld by the floor of survey households, said, never 0
  const shown = (value, format) =>
    value === null ? "Not published" : format(value);
  const cards = [
    ["People affected", shown(stats.peopleAffected, formatPercent)],
    [
      "Relative change in the Gini index",
      shown(stats.giniChange, formatRelative),
    ],
    [
      "Change in absolute poverty, before housing costs",
      shown(stats.povertyChangePp, formatPoints),
    ],
    [
      "Relative change in absolute poverty",
      shown(stats.povertyChangePct, formatPercent),
    ],
  ];
  return (
    <section
      className="publication-stats"
      aria-label={`Combined statistics, ${fiscalYearLabel(stats.year)}`}
    >
      {stats.provisional && (
        <p className="publication-provisional">{provisionalLabel(manifest)}</p>
      )}
      <dl className="publication-stats-grid">
        {cards.map(([label, value]) => (
          <div className="publication-stat" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default CombinedStats;
