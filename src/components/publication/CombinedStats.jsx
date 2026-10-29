import { provisionalNotice } from "../../utils/publication/manifest";
import {
  fiscalYearLabel,
  formatPercent,
  formatPoints,
  formatRelative,
} from "../../utils/publication/format";
import UnavailableNotice from "./UnavailableNotice";
import { POVERTY_FIGURES_SHOWN } from "../../utils/povertyFigures";
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
 * The provisional notice is the manifest's (provisionalNotice): the
 * candidate label before the Budget, none for statement figures from
 * Budget day.
 *
 * Not on the page today. While the poverty and people-affected figures are
 * withheld (povertyFigures.js), only the Gini card is drawn.
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
  const cards = (
    POVERTY_FIGURES_SHOWN
      ? [
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
        ]
      : [["Relative change in the Gini index", formatRelative(stats.giniChange)]]
  );
  return (
    <section
      className="publication-stats"
      aria-label={`Combined statistics, ${fiscalYearLabel(stats.year)}`}
    >
      {stats.provisional && provisionalNotice(manifest) && (
        <p className="publication-provisional">{provisionalNotice(manifest)}</p>
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
