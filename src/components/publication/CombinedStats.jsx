import { PROVISIONAL_LABEL } from "../../utils/publication/manifest";
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
 * @param {{stats: Object, measureNames?: Object<string, string>}} props
 */
function CombinedStats({ stats, measureNames = {} }) {
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
  const cards = [
    ["People affected", formatPercent(stats.peopleAffected)],
    ["Relative change in the Gini index", formatRelative(stats.giniChange)],
    [
      "Change in absolute poverty, before housing costs",
      formatPoints(stats.povertyChangePp),
    ],
    [
      "Relative change in absolute poverty",
      formatPercent(stats.povertyChangePct),
    ],
  ];
  return (
    <section
      className="publication-stats"
      aria-label={`Combined statistics, ${fiscalYearLabel(stats.year)}`}
    >
      {stats.provisional && (
        <p className="publication-provisional">{PROVISIONAL_LABEL}</p>
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
