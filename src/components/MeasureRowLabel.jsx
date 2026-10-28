// A measure's label on every chart with one row per measure: a small icon
// in a circle tinted with the measure's colour, chosen from the measure's
// category (derived from the publication for any measure: see
// utils/measureCategory.js), the short name (three lines at most on a narrow
// card) and the full name in a Tip. The icon already says the category, so
// the muted category caption under the name is opt-in (`caption`), for a
// list where it is the only explanation of a measure (the policy picker).
// `compact` shrinks the tile for dense lists (keys, tooltips, tables);
// `tip={false}` where the row already has one.

import Tip from "./Tip";
import TitleIcon, { titleIconPaths } from "./TitleIcon";
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
 * The icon tile alone, for a row that keeps its own text (a tooltip's row,
 * a chart's legend): the same derived icon, in the measure's colour.
 */
export function MeasureIcon({ measure, colour, compact = false }) {
  const { icon } = measureCategoryOf(measure);
  return (
    <span className={compact ? "mrl-icon mrl-icon--compact" : "mrl-icon"} aria-hidden="true" style={{ "--mrl-colour": colour ?? measure?.color ?? CHART_COLOURS.noChange }}>
      <TitleIcon name={icon} bare size={compact ? 11 : 13} />
    </span>
  );
}

/**
 * @param {{measure: Object, colour?: string, name?: string, compact?: boolean, tip?: boolean, nameClassName?: string}} props -
 *   The catalogue's measure (id, label or name, color); `name` overrides the
 *   short name
 */
export default function MeasureRowLabel({ measure, colour, name, compact = false, caption = false, tip = true, nameClassName }) {
  const { label: category } = measureCategoryOf(measure);
  const short = name ?? shortNameOf(measure);
  const full = measure?.label ?? measure?.name ?? short;
  const text = (
    <span className="mrl-text" tabIndex={tip ? 0 : undefined}>
      <span className={nameClassName ? `mrl-name ${nameClassName}` : "mrl-name"}>{short}</span>
      {caption && !compact && <span className="mrl-caption">{category}</span>}
    </span>
  );
  return (
    <span className={compact ? "mrl mrl--compact" : "mrl"} style={{ "--mrl-colour": colour ?? measure?.color ?? CHART_COLOURS.noChange }}>
      <MeasureIcon measure={measure} colour={colour} compact={compact} />
      {tip ? <Tip content={full}>{text}</Tip> : text}
    </span>
  );
}

/** The tile's width and gap in an SVG chart: what a chart adds to its name column. */
export const SVG_LABEL_INDENT = { full: 32, compact: 26 };

/**
 * The same label drawn inside a chart's own SVG (so an exported PNG keeps
 * it): the tinted tile and icon, the short name and, with `caption` (not
 * `compact`), the category under it. `y` is the label's vertical centre.
 */
export function SvgMeasureLabel({ measure, colour, name, x = 0, y, fontSize = 13, compact = false, caption = false, textProps = {}, nameColour, captionColour }) {
  const withCaption = caption && !compact;
  const { label: category, icon } = measureCategoryOf(measure);
  const fill = colour ?? measure?.color ?? CHART_COLOURS.noChange;
  const radius = compact ? 9 : 12;
  const glyph = compact ? 11 : 13;
  const textX = x + (compact ? SVG_LABEL_INDENT.compact : SVG_LABEL_INDENT.full);
  return (
    <g className="mrl-svg">
      <circle className="mrl-svg-tile" cx={x + radius} cy={y} r={radius} fill={fill} fillOpacity={0.16} aria-hidden="true" />
      <svg x={x + radius - glyph / 2} y={y - glyph / 2} width={glyph} height={glyph} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={fill} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {titleIconPaths(icon)}
      </svg>
      <text className="mrl-svg-name" x={textX} y={withCaption ? y - 6 : y} dy="0.35em" {...textProps} fill={nameColour} fontSize={fontSize} fontWeight={500}>
        {name ?? shortNameOf(measure)}
      </text>
      {withCaption && (
        <text className="mrl-svg-caption" x={textX} y={y + 9} dy="0.35em" {...textProps} fill={captionColour} fontSize={11}>
          {category}
        </text>
      )}
    </g>
  );
}
