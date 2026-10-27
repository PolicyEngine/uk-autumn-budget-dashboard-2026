// A measure's label on every chart with one row per measure: a small icon
// in a circle tinted with the measure's colour, chosen from the measure's
// category (its tax or benefit type, never its id), the short name (two
// lines at most on a narrow card) with the category as a muted caption under it, and the full name in
// a Tip.

import Tip from "./Tip";
import TitleIcon from "./TitleIcon";
import { policyDetailsFor, shortNameOf } from "../utils/policyDetails";
import { CHART_COLOURS } from "../utils/chartTheme";
import "./MeasureRowLabel.css";

// Category words to icons; the first match wins, "tag" otherwise
const ICON_BY_CATEGORY = [
  [/\bvat\b/i, "receipt"],
  [/fuel/i, "fuel"],
  [/income tax/i, "wallet"],
  [/national insurance/i, "briefcase"],
  [/capital gains/i, "trend"],
  [/student/i, "cap"],
  [/pension|benefit|credit|allowance/i, "piggy"],
  [/energy|electric|gas|heat/i, "flame"],
  [/council tax|property|housing/i, "house"],
];

/** A measure's category (its tax or benefit type), or null. */
export function measureCategory(measure) {
  return policyDetailsFor(measure)?.type ?? measure?.type ?? null;
}

/** The icon for a category, by its words. */
export function categoryIcon(category) {
  if (!category) return "tag";
  return ICON_BY_CATEGORY.find(([pattern]) => pattern.test(category))?.[1] ?? "tag";
}

/**
 * @param {{measure: Object, colour?: string, name?: string}} props - The
 *   catalogue's measure (id, label or name, color); `name` overrides the
 *   short name
 */
export default function MeasureRowLabel({ measure, colour, name }) {
  const category = measureCategory(measure);
  const short = name ?? shortNameOf(measure);
  const full = measure?.label ?? measure?.name ?? short;
  return (
    <span className="mrl" style={{ "--mrl-colour": colour ?? measure?.color ?? CHART_COLOURS.noChange }}>
      <span className="mrl-icon" aria-hidden="true">
        <TitleIcon name={categoryIcon(category)} bare size={13} />
      </span>
      <Tip content={full}>
        <span className="mrl-text" tabIndex={0}>
          <span className="mrl-name">{short}</span>
          {category && <span className="mrl-caption">{category}</span>}
        </span>
      </Tip>
    </span>
  );
}
