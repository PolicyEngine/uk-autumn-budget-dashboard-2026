// A measure's label on every chart with one row per measure: a small icon
// in a circle tinted with the measure's colour, chosen from the measure's
// category (derived from the publication for any measure: see
// utils/measureCategory.js), the short name (three lines at most on a narrow
// card) with the category as a muted caption under it, and the full name in
// a Tip. `compact` drops the caption and shrinks the tile for dense lists
// (keys, tooltips, tables); `tip={false}` where the row already has one.

import Tip from "./Tip";
import TitleIcon from "./TitleIcon";
import { shortNameOf } from "../utils/policyDetails";
import { categoryIcon, measureCategoryOf } from "../utils/measureCategory";
import { CHART_COLOURS } from "../utils/chartTheme";
import "./MeasureRowLabel.css";

/** A measure's category caption (its tax or benefit type): never null. */
export function measureCategory(measure) {
  return measureCategoryOf(measure).label;
}

export { categoryIcon };

/**
 * @param {{measure: Object, colour?: string, name?: string, compact?: boolean, tip?: boolean}} props -
 *   The catalogue's measure (id, label or name, color); `name` overrides the
 *   short name
 */
export default function MeasureRowLabel({ measure, colour, name, compact = false, tip = true }) {
  const { label: category, icon } = measureCategoryOf(measure);
  const short = name ?? shortNameOf(measure);
  const full = measure?.label ?? measure?.name ?? short;
  const text = (
    <span className="mrl-text" tabIndex={tip ? 0 : undefined}>
      <span className="mrl-name">{short}</span>
      {!compact && <span className="mrl-caption">{category}</span>}
    </span>
  );
  return (
    <span className={compact ? "mrl mrl--compact" : "mrl"} style={{ "--mrl-colour": colour ?? measure?.color ?? CHART_COLOURS.noChange }}>
      <span className="mrl-icon" aria-hidden="true">
        <TitleIcon name={icon} bare size={compact ? 11 : 13} />
      </span>
      {tip ? <Tip content={full}>{text}</Tip> : text}
    </span>
  );
}
