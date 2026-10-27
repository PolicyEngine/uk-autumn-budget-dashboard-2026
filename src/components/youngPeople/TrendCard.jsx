import { useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Customized, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import ControlBar from "../ControlBar";
import SeriesToggle from "../SeriesToggle";
import { measureOpacity, useMeasureKey, netOpacity } from "../MeasureKey";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
  CHART_COLOURS,
  REFERENCE_DASH,
  PHONE_QUERY,
  useViewportMatch,
} from "../../utils/chartTheme";
import { DISPLAY_YEARS, NOT_YET_PUBLISHED, useDisplayYears } from "../../utils/displayYears";
import { X_AXIS_HEIGHT, plotMargin } from "./chartRows";
import { AGE_GROUPS, ALL_BAND, COMBINATION_NOT_PUBLISHED, PACKAGE_NET_ONLY, YOUNG_BAND } from "../../utils/ageImpact";
import {
  GROUP_STYLES,
  changeByYear,
  cumulate,
  groupMeasureSeries,
  fitRange,
  pounds,
  signedPounds,
  stepAnnotations,
  topParts,
} from "./youngPeopleData";
import { chartTransition } from "../../utils/chartMotion";
import { PENSIONERS, groupLabel, groupSeries, groupSubject } from "../../utils/ageGroups";
import { legendMembership } from "../../utils/legendMembership";
import { selectionPackageKey } from "../../utils/geography/selection";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { shortNameOf } from "../../utils/policyDetails";
import TitleIcon from "../TitleIcon";
import ChartMoreInfo from "../ChartMoreInfo";
import Note from "../Note";
import { BY_YEAR_METHOD } from "../methodology/anchors";

/** Every age group's line, 16 to 24 first. */
export const SERIES = AGE_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  short: group.short,
  ...GROUP_STYLES[group.key],
}));

export const TREND_DESCRIPTION = "Average change per person, £ a year.";
const cumulativeDescription = (first) => `Running total per person from ${fiscalYearTick(first)}, £.`;


// The focus group in the brand colour, all ages as the reference, the rest
// as faint context
const FOCUS_COLOUR = CHART_COLOURS.gain;
// The other age groups in the focus view: each its own muted colour and
// dash, so a line matches its chip; faint until hovered
const CONTEXT_DASH = { "0-15": "2 3", "16-24": "3 2", "25-34": undefined, "35-49": "8 3", "50-64": "1 2", "65+": "6 2 1 2" };
const CONTEXT_OPACITY = 0.45;
// The invisible stroke over each line that takes the hover, so a thin line
// is easy to point at
const HIT_WIDTH = 12;
const SELECTED_FILL = CHART_COLOURS.highlightBand;


const compareOptions = (label) => [
  { value: "focus", label: `${label} vs all ages`, summary: `${label} vs all` },
  { value: "groups", label: "All age groups", summary: "All groups" },
];
const viewOptions = (label) => [
  { value: "lines", label: "Lines", summary: "Lines" },
  { value: "measures", label: `Policies, ${label}`, summary: "By policy" },
];
const YEARS_OPTIONS = [
  { value: "each", label: "Each year", summary: "Each year" },
  { value: "total", label: "Running total", summary: "Running total" },
];

/** "2027-28 to 2031-32" for a run of years, else "2027-28, 2029-30 and 2031-32". */
export const yearList = (years) => {
  if (years.length > 1 && years.every((year, i) => i === 0 || year === years[i - 1] + 1)) {
    return `${fiscalYearTick(years[0])} to ${fiscalYearTick(years[years.length - 1])}`;
  }
  const labels = years.map(fiscalYearTick);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0] ?? "";
};

/**
 * Why some age groups' lines stop: a selected policy publishes all ages
 * but not those groups in some years (its age bands withheld, as too few
 * survey records), so their sum is unavailable there. Null when every
 * group is complete in every published year.
 */
export function missingGroupsNote(points, labelOf) {
  const gaps = points.filter((point) => point.published && point.missing?.length > 0);
  if (!gaps.length) return null;
  const keys = [...new Set(gaps.flatMap((point) => point.missing))];
  const groups = keys.length >= AGE_GROUPS.length - 1 ? "every age group except all ages" : keys.map(labelOf).join(", ");
  return `Not drawn in ${yearList(gaps.map((point) => point.year))}, as a selected policy has too few survey records by age: ${groups}.`;
}

/** "+£120", "−£180": a change with a true minus. */
export const signed = (value) => {
  const rounded = Math.round(value);
  if (rounded === 0) return "£0";
  return `${rounded > 0 ? "+" : "−"}£${Math.abs(rounded).toLocaleString("en-GB")}`;
};
/** "about £120": to the nearest £10 above £50, else to the pound. */
export const about = (value) => {
  const size = Math.abs(value);
  const rounded = size >= 50 ? Math.round(size / 10) * 10 : Math.round(size);
  return `about £${rounded.toLocaleString("en-GB")}`;
};

/**
 * The selected year's shading, and each unpublished year's grey band with
 * "Not yet published" on two lines, under the lines.
 */
export function YearShading({ xAxisMap, yAxisMap, selectedYear, unpublishedYears, years = DISPLAY_YEARS }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis) return null;
  const bandwidth = xAxis.scale.bandwidth?.();
  const step = bandwidth
    ? xAxis.scale(years[1]) - xAxis.scale(years[0])
    : years.length > 1
      ? xAxis.scale(years[1]) - xAxis.scale(years[0])
      : xAxis.width;
  const band = (year) => {
    const start = xAxis.scale(year);
    if (start === undefined || Number.isNaN(start)) return null;
    const centre = bandwidth ? start + bandwidth / 2 : start;
    const left = Math.max(xAxis.x, centre - step / 2);
    const right = Math.min(xAxis.x + xAxis.width, centre + step / 2);
    return { x: left, width: right - left, centre };
  };
  const selected = band(selectedYear);
  return (
    <g className="young-people-year-shading">
      {selected && !unpublishedYears.includes(selectedYear) && (
        <rect
          x={0}
          y={yAxis.y}
          width={selected.width}
          height={yAxis.height}
          fill={SELECTED_FILL}
          style={{
            transform: `translateX(${selected.x}px)`,
            transition: chartTransition("transform", "width"),
          }}
        />
      )}
      {unpublishedYears.map((year) => {
        const area = band(year);
        if (!area) return null;
        return (
          <g key={year}>
            <rect x={area.x} y={yAxis.y} width={area.width} height={yAxis.height} fill={CHART_COLOURS.mutedFill} />
            <text x={area.centre} y={yAxis.y + 16} textAnchor="middle" fontSize={11} fill={CHART_COLOURS.tick}>
              <tspan x={area.centre}>Not yet</tspan>
              <tspan x={area.centre} dy={13}>{" published"}</tspan>
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Where a year sits on the x axis (a band's centre for bars). */
export function xOf(xAxis, year) {
  const start = xAxis.scale(year);
  if (start === undefined || Number.isNaN(start)) return null;
  return start + (xAxis.scale.bandwidth?.() ?? 0) / 2;
}

/**
 * Each line's name at its last point, in its colour, nudged apart so no
 * two overlap; hovering a name brings its line forward, as hovering the
 * line does.
 */
export function EndLabels({ xAxisMap, yAxisMap, data, lines, hovered, onHover, narrow }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const labels = [];
  // In the focus view only the lines in colour are named; a grey context
  // line is named while it is hovered
  for (const line of lines.filter((each) => each.strong || each.key === hovered)) {
    const last = [...data].reverse().find((point) => point[line.key] !== null && point[line.key] !== undefined);
    if (!last) continue;
    const x = xOf(xAxis, last.year);
    if (x === null) continue;
    labels.push({ ...line, x: x + 8, y: yAxis.scale(last[line.key]) });
  }
  // Top to bottom, at least 13px apart
  labels.sort((a, b) => a.y - b.y);
  const GAP = 13;
  for (let i = 1; i < labels.length; i += 1) {
    if (labels[i].y - labels[i - 1].y < GAP) labels[i].y = labels[i - 1].y + GAP;
  }
  return (
    <g className="trend-end-labels">
      {labels.map((label) => (
        <text
          key={label.key}
          x={label.x}
          y={label.y}
          dy="0.35em"
          fontSize={narrow ? 11 : 12}
          fontWeight={label.strong || hovered === label.key ? 600 : 400}
          fill={hovered === label.key ? label.hoverColour ?? label.colour : label.textColour ?? label.colour}
          style={{ cursor: "default" }}
          onMouseEnter={() => onHover(label.key)}
          onMouseLeave={() => onHover(null)}
        >
          {narrow ? label.short : label.label}
        </text>
      ))}
    </g>
  );
}

const STEP_FONT = 12;
const STEP_BOX_HEIGHT = STEP_FONT + 8;
// The gap between a box and the plot's top gridline or its x axis, so a
// box never sits on either
export const STEP_INSET = 6;

/** Whether a box overlaps anything drawn: a count of the hits, for choosing the clearer place. */
function stepBoxHits(box, { segments, columns, zero, grid = [] }) {
  const pad = 3;
  const inside = (px, py) =>
    px >= box.left - pad && px <= box.left + box.width + pad && py >= box.top - pad && py <= box.top + box.height + pad;
  let hits = 0;
  for (const [x1, y1, x2, y2] of segments) {
    // Sampled every 2px along the segment
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
    for (let i = 0; i <= steps; i += 1) {
      if (inside(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps)) {
        hits += 1;
        break;
      }
    }
  }
  for (const column of columns) {
    if (column.right >= box.left && column.left <= box.left + box.width && column.bottom >= box.top && column.top <= box.top + box.height) hits += 1;
  }
  if (Number.isFinite(zero) && zero >= box.top - pad && zero <= box.top + box.height + pad) hits += 1;
  // A gridline through the box
  for (const y of grid) {
    if (y >= box.top - 1 && y <= box.top + box.height + 1) hits += 1;
  }
  return hits;
}

/**
 * Where each step's label goes: in a box just inside the plot's top or
 * bottom edge (STEP_INSET clear of the top gridline and the x axis), over
 * its year and kept inside the plot (clear of the line names in the right
 * margin), with a leader down or up to the point. The place is the one
 * that crosses fewest of the lines, bars, gridlines and £0 line: a rise's
 * label at the top, a fall's at the foot when both are clear, then the
 * other edge, then the box slid along the edge (its leader still inside
 * it); a second label whose box would meet the first's goes elsewhere.
 * Null when a label cannot fit across the plot: the card's sentence
 * carries the steps then.
 *
 * @param {Object} args
 * @param {Array<{year: number, step: number, text: string}>} args.notes
 * @param {{x: number, width: number, scale: Function}} args.xAxis
 * @param {{y: number, height: number, scale: Function}} args.yAxis
 * @param {(year: number) => number|null} args.valueAt - The focus line's value
 * @param {Array<Array<number|null>>} [args.paths] - Each drawn line's values, one per year in `years`
 * @param {Array<{year: number, high: number, low: number}>} [args.columns] - Each year's stack, by measure
 * @param {Array<number>} [args.years]
 * @param {Array<number>} [args.gridValues] - The y ticks, whose gridlines a box should miss
 */
export function placeStepLabels({ notes, xAxis, yAxis, valueAt, paths = [], columns = [], years = [], gridValues = [] }) {
  const top = yAxis.y + STEP_INSET;
  const bottom = yAxis.y + yAxis.height - STEP_INSET - STEP_BOX_HEIGHT;
  const grid = gridValues.map((value) => yAxis.scale(value)).filter(Number.isFinite);
  const plotLeft = xAxis.x;
  const plotRight = xAxis.x + xAxis.width;
  const zero = yAxis.scale(0);
  const band = xAxis.scale.bandwidth?.() ?? 0;
  // What is drawn: each line's straight segments and each year's stack
  const segments = [];
  for (const values of paths) {
    for (let i = 1; i < years.length; i += 1) {
      const [a, b] = [values[i - 1], values[i]];
      const [xa, xb] = [xOf(xAxis, years[i - 1]), xOf(xAxis, years[i])];
      if (a === null || a === undefined || b === null || b === undefined || xa === null || xb === null) continue;
      segments.push([xa, yAxis.scale(a), xb, yAxis.scale(b)]);
    }
  }
  const boxes = columns
    .map((column) => {
      const x = xOf(xAxis, column.year);
      if (x === null) return null;
      return { left: x - band * 0.36, right: x + band * 0.36, top: yAxis.scale(column.high), bottom: yAxis.scale(column.low) };
    })
    .filter(Boolean);
  const placed = [];
  for (const note of notes) {
    const value = valueAt(note.year);
    const x = xOf(xAxis, note.year);
    if (value === null || value === undefined || x === null) continue;
    // An estimate of the text's width, for its box
    const width = note.text.length * STEP_FONT * 0.56 + 12;
    if (width > plotRight - plotLeft) return null;
    const clamp = (start) => Math.min(Math.max(start, plotLeft), plotRight - width);
    const centred = clamp(x - width / 2);
    const edges = note.step < 0 ? [bottom, top] : [top, bottom];
    // Centred over the year first; then slid along the edge, by half a year
    // and a year, as long as the leader still lands inside the box
    const slides = [0, -0.5, 0.5, -1, 1].map((k) => clamp(centred + k * Math.max(band, 24)));
    const candidates = [];
    for (const boxTop of edges) {
      for (const left of slides) {
        if (x < left + 8 || x > left + width - 8) continue;
        if (candidates.some((each) => each.boxTop === boxTop && each.left === left)) continue;
        candidates.push({ boxTop, left });
      }
    }
    const meets = ({ boxTop, left }) =>
      placed.some((other) => other.top === boxTop && other.left < left + width + 6 && left < other.left + other.width + 6);
    const scored = candidates
      .filter((each) => !meets(each))
      .map((each) => ({
        ...each,
        hits: stepBoxHits({ left: each.left, top: each.boxTop, width, height: STEP_BOX_HEIGHT }, { segments, columns: boxes, zero, grid }),
      }));
    if (!scored.length) return null;
    // The first place unless a later one crosses less
    const best = scored.reduce((winner, each) => (each.hits < winner.hits ? each : winner));
    const y = yAxis.scale(value);
    placed.push({ year: note.year, text: note.text, x, y, left: best.left, top: best.boxTop, width, height: STEP_BOX_HEIGHT });
  }
  return placed;
}

/**
 * The measure behind each big step, named in a small white box at the
 * plot's edge with a short leader to the focus line's point (see
 * placeStepLabels); nothing when the labels cannot fit.
 */
export function StepLabels({ xAxisMap, yAxisMap, notes, valueAt, paths, columns, years, gridValues }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const labels = placeStepLabels({ notes, xAxis, yAxis, valueAt, paths, columns, years, gridValues });
  if (!labels?.length) return null;
  return (
    <g className="trend-step-labels" aria-hidden="true">
      {labels.map((label) => {
        const above = label.top < label.y;
        return (
          <g key={label.year} data-step-year={label.year}>
            <line
              x1={label.x}
              x2={label.x}
              y1={label.y + (above ? -6 : 6)}
              y2={above ? label.top + label.height : label.top}
              stroke={CHART_COLOURS.tick}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <rect
              x={label.left}
              y={label.top}
              width={label.width}
              height={label.height}
              rx={4}
              fill={CHART_COLOURS.surface}
              stroke={CHART_COLOURS.axis}
              strokeWidth={1}
            />
            <text
              x={label.left + label.width / 2}
              y={label.top + label.height / 2}
              dy="0.35em"
              textAnchor="middle"
              fontSize={STEP_FONT}
              fill={CHART_COLOURS.text}
              fontWeight={500}
            >
              {label.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** One year: the focus group, all ages and the focus group's top measures. */
export function TrendTooltip({ active, payload, label, focusSeries, allValue, nameOf, cumulative, selectedYear, groupValue, groupLabel }) {
  if (!active || !payload?.length) return null;
  const year = Number(label);
  const point = focusSeries.find((each) => each.year === year);
  const mine = groupValue(year);
  if (mine === null || mine === undefined) return null;
  const top = cumulative ? [] : topParts(point, 2);
  const suffix = cumulative ? " to date" : " a year";
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        {fiscalYearTick(year)}
        {year === Number(selectedYear) ? " · selected year" : ""}
      </p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: FOCUS_COLOUR }} />
        <span className="chart-tooltip-name">{groupLabel}</span>
        <span className="chart-tooltip-value">{signed(mine)}{suffix}</span>
      </div>
      {allValue(year) !== null && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-swatch chart-tooltip-swatch-line" style={{ background: CHART_COLOURS.reference }} />
          <span className="chart-tooltip-name">All ages</span>
          <span className="chart-tooltip-value">{signed(allValue(year))}{suffix}</span>
        </div>
      )}
      {top.length > 0 && (
        <p className="chart-tooltip-note">
          Mostly: {top.map((part) => `${nameOf(part.id)} ${signed(part.value)}`).join("; ")}
        </p>
      )}
    </div>
  );
}

/** Each year's stack of measures, its top and foot, for keeping labels off the bars. */
export function stackColumns(data, partKeys) {
  return data
    .filter((point) => point.net !== null && point.net !== undefined)
    .map((point) => {
      const values = partKeys.map((each) => point[each]).filter((v) => v !== null && v !== undefined);
      return {
        year: point.year,
        high: values.reduce((sum, v) => sum + Math.max(0, v), 0),
        low: values.reduce((sum, v) => sum + Math.min(0, v), 0),
      };
    });
}

/**
 * On a phone, where the plot has no room for the step labels: "The step
 * in 2027-28 is from zero VAT on electricity." for each step the headline
 * does not already name, or null.
 */
export function stepSentence(notes, headline, nameIn) {
  // Named already when the headline has both its year and its measure
  const named = (note) =>
    (headline ?? "").includes(fiscalYearTick(note.year)) && (headline ?? "").includes(`the ${nameIn(note.measureId)}`);
  const missing = notes.filter((note) => !named(note));
  if (!missing.length) return null;
  const parts = missing.map((note) => `in ${fiscalYearTick(note.year)} from the ${nameIn(note.measureId)}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `The ${missing.length > 1 ? "biggest steps come" : "biggest step comes"} ${list}.`;
}

/**
 * How the change for 16 to 24-year-olds moves year by year, against all
 * ages, with the other age groups as faint context, the measures behind
 * the biggest steps named on the line, and a breakdown by measure. Straight
 * segments between the annual points: there is nothing between them.
 */
function TrendCard({ rows, policies, selectedPolicies, selectedYear, narrow, height, group = YOUNG_BAND, extraOptions = [] }) {
  const shownYears = useDisplayYears();
  // The focus group (By age's Age group): an age band, or pensioners from
  // their single years of age, which join the lines as a series of their own
  const FOCUS = group;
  const FOCUS_LABEL = groupLabel(group);
  const SUBJECT = groupSubject(group);
  const SERIES_LIST = group === PENSIONERS ? [...SERIES, { key: PENSIONERS, label: "Pensioners", short: "Pens." }] : SERIES;
  const chartRef = useRef(null);
  const catalogue = useMeasureCatalogue();
  // On a phone the step labels do not fit the plot: the sentence names them
  const phone = useViewportMatch(PHONE_QUERY);
  const [compare, setCompare] = useState("focus");
  const [view, setView] = useState("lines");
  const [years, setYears] = useState("each");
  const [hovered, setHovered] = useState(null);
  // All age groups: which lines are drawn (SeriesToggle), every one at first
  const [shownGroups, setShownGroups] = useState(() => SERIES_LIST.map((series) => series.key));
  const groupsView = compare === "groups" && view === "lines";
  // The focus view: 16 to 24, all ages and the other groups (one chip for
  // all of them), every one at first
  // Every group on at first: 16 to 24 and all ages strong, the others faint
  const [shownFocus, setShownFocus] = useState(() => SERIES_LIST.map((series) => series.key));
  const focusView = compare === "focus" && view === "lines";
  /** Whether a line is drawn in the view shown. */
  const isShown = (key) =>
    groupsView
      ? shownGroups.includes(key)
      : focusView
        ? shownFocus.includes(key)
        : true;
  const cumulative = years === "total";
  const byMeasure = view === "measures";

  // The published combined run of exactly the selection, read as is
  const packageRun = selectionPackageKey(catalogue?.manifest, selectedPolicies);
  const bands = useMemo(
    () => changeByYear(rows, policies, selectedPolicies, shownYears, packageRun),
    [rows, policies, selectedPolicies, shownYears, packageRun],
  );
  const focusSeries = useMemo(() => {
    const series = groupSeries(rows, policies, selectedPolicies, shownYears, FOCUS, packageRun);
    // A year the combination is not published by age: no figure for the group either
    return series.map((point, i) =>
      bands[i]?.combinationUnavailable ? { year: point.year, published: false, net: null, parts: [] } : point,
    );
  }, [rows, policies, selectedPolicies, shownYears, FOCUS, packageRun, bands]);
  // The package's net with no policy parts (a selected policy withholds its rows by age)
  const netOnly = focusSeries.some((point) => point.fromPackage && !point.partsShown);
  const combinationYears = bands.filter((point) => point.combinationUnavailable).map((point) => point.year);
  // Not one year published for this combination: a notice, not empty axes
  const combinationEverywhere =
    combinationYears.length > 0 && bands.every((point) => !point.published || point.combinationUnavailable);
  const combinationNote = !combinationEverywhere && combinationYears.length
    ? `${COMBINATION_NOT_PUBLISHED.replace(" yet.", "")} for ${yearList(combinationYears)}.`
    : null;
  // Pensioners' line from their own series; the bands from the age rows
  const raw = group === PENSIONERS ? bands.map((point, i) => ({ ...point, [PENSIONERS]: focusSeries[i]?.net ?? null })) : bands;
  const groupKeys = SERIES_LIST.map((series) => series.key);
  const lineData = cumulative ? cumulate(raw, groupKeys) : raw;
  const partKeys = [...new Set(focusSeries.flatMap((point) => point.parts.map((part) => part.key)))];
  const barData = useMemo(() => {
    const merged = focusSeries.map((point, i) => ({ ...point, all: raw[i]?.[ALL_BAND] ?? null }));
    return cumulative ? cumulate(merged, [...partKeys, "net", "all"]) : merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeries, raw, cumulative]);
  const data = byMeasure ? barData : lineData;

  const measure = (id) => catalogue.byId.get(id);
  const nameOf = (id) => (measure(id) ? shortNameOf(measure(id)) : id);
  // In a sentence: "the threshold freeze", but "the BADR cut" keeps its capitals
  const inSentence = (name) => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);
  const notes = useMemo(
    () =>
      stepAnnotations(focusSeries).map((note) => ({
        ...note,
        text: `${nameOf(note.measureId)}${narrow ? "" : `, ${fiscalYearTick(note.year)}`}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusSeries, catalogue, narrow],
  );

  // The measures in the breakdown, for the section's key (MeasureKey)
  const members = useMemo(
    () =>
      byMeasure
        ? legendMembership(catalogue, selectedPolicies, (id) =>
            focusSeries.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
          )
        : [],
    [byMeasure, catalogue, selectedPolicies, focusSeries],
  );
  const key = useMeasureKey(members, byMeasure ? "Net change" : undefined);

  // The axis over what is drawn: the lines, or the stacks and their net
  const values = byMeasure
    ? barData.flatMap((point) => {
        if (point.net === null) return [];
        const keys = partKeys.filter((each) => point[each] !== null && point[each] !== undefined);
        const up = keys.reduce((sum, each) => sum + Math.max(0, point[each]), 0);
        const down = keys.reduce((sum, each) => sum + Math.min(0, point[each]), 0);
        return [up, down, point.net];
      })
    : lineData
        // All age groups: fitted to the lines shown
        .flatMap((point) => groupKeys.filter(isShown).map((each) => point[each]))
        .filter((v) => v !== null && v !== undefined);
  // Fitted to what is drawn, a little room either side
  const { domain, ticks } = fitRange(Math.min(0, ...values), Math.max(0, ...values));

  const unpublished = raw.filter((point) => !point.published);
  const suppressed = raw.filter((point) => point.published && point.suppressed.length > 0);
  const labelOf = (each) => SERIES.find((series) => series.key === each)?.label ?? each;
  // A selected policy with all ages but no age bands in some years: said,
  // never a line that silently stops
  const missingNote = byMeasure ? null : missingGroupsNote(raw, labelOf);
  const first = fiscalYearTick(shownYears[0]);
  const last = fiscalYearTick(shownYears[shownYears.length - 1]);
  const title = `Change by year, ${first} to ${last}`;
  const description = cumulative ? cumulativeDescription(shownYears[0]) : TREND_DESCRIPTION;

  // The headline, one plain sentence with the units folded in: the
  // selected year, then the step after it that changes it most ("16 to
  // 24-year-olds gain about £32 a person in 2029-30 and lose about £170
  // from 2031-32, when the threshold freeze applies.")
  const selected = focusSeries.find((point) => point.year === Number(selectedYear));
  const headline = (() => {
    if (cumulative) {
      const shown = focusSeries.filter((point) => point.net !== null);
      if (!shown.length) return null;
      const total = shown.reduce((sum, point) => sum + point.net, 0);
      const span = `${fiscalYearTick(shown[0].year)} to ${fiscalYearTick(shown[shown.length - 1].year)}`;
      if (Math.round(Math.abs(total)) === 0) return `${SUBJECT} see almost no change in total from ${span}.`;
      return `${SUBJECT} ${total >= 0 ? "gain" : "lose"} ${about(total)} a person in total from ${span}.`;
    }
    if (!selected || selected.net === null) return null;
    const none = (value) => Math.round(Math.abs(value)) === 0;
    // About £0 is no gain or loss: said as almost no change
    let text = none(selected.net)
      ? `${SUBJECT} see almost no change in ${fiscalYearTick(selected.year)}`
      : `${SUBJECT} ${selected.net >= 0 ? "gain" : "lose"} ${about(selected.net)} a person in ${fiscalYearTick(selected.year)}`;
    // The biggest step after the selected year
    const later = notes.filter((note) => note.year > selected.year).sort((x, y) => Math.abs(y.step) - Math.abs(x.step))[0];
    if (later) {
      const sameWay = !none(selected.net) && !none(later.value) && Math.sign(later.value) === Math.sign(selected.net);
      const level = none(later.value)
        ? "see almost no change"
        : sameWay
          ? about(later.value)
          : `${later.value >= 0 ? "gain" : "lose"} ${about(later.value)}`;
      text += ` and ${level} from ${fiscalYearTick(later.year)}, when the ${inSentence(nameOf(later.measureId))} applies`;
    }
    return `${text}.`;
  })();
  // On a phone, the steps the plot cannot label, unless the headline names them
  const stepsLine = phone && !cumulative ? stepSentence(notes, headline, (id) => inSentence(nameOf(id))) : null;

  // A line's colour: the focus in the brand colour; 16 to 24, whose own
  // colour that is, in a darker teal when another group is the focus
  const colourOf = (series) =>
    series.key === FOCUS ? FOCUS_COLOUR : series.key === YOUNG_BAND ? CHART_COLOURS.highlight : series.color;
  // The lines, drawn context first so the focus is on top
  const lines = (() => {
    if (compare === "groups") {
      return SERIES_LIST.map((series) => ({
        key: series.key,
        label: series.label,
        short: series.short,
        colour: series.key === ALL_BAND ? CHART_COLOURS.reference : colourOf(series),
        dash: series.dash,
        width: series.key === FOCUS ? 3 : 1.75,
        strong: series.key === FOCUS,
      }));
    }
    return SERIES_LIST.map((series) => {
      if (series.key === FOCUS) {
        return { key: series.key, label: series.label, short: series.short, colour: FOCUS_COLOUR, width: 3, strong: true };
      }
      if (series.key === ALL_BAND) {
        return { key: series.key, label: series.label, short: series.short, colour: CHART_COLOURS.reference, dash: REFERENCE_DASH, width: 2, strong: true };
      }
      return {
        key: series.key,
        label: series.label,
        short: series.short,
        colour: colourOf(series),
        dash: CONTEXT_DASH[series.key],
        context: true,
        width: hovered === series.key ? 2.5 : 1.5,
      };
    });
  })();
  const ordered = [
    ...lines.filter((line) => !line.strong && line.key !== hovered),
    ...lines.filter((line) => !line.strong && line.key === hovered),
    ...lines.filter((line) => line.strong && line.key !== FOCUS),
    ...lines.filter((line) => line.key === FOCUS),
  ];

  // A faint context line has no dots, so a value with no neighbour (its
  // line stopping either side) gets one, or it would not be drawn at all
  const loneDot = (line) => {
    const present = (i) => data[i]?.[line.key] !== null && data[i]?.[line.key] !== undefined;
    return function LoneDot({ cx, cy, index }) {
      if (!present(index) || present(index - 1) || present(index + 1) || cx === undefined || cy === undefined) {
        return <g key={`lone-${line.key}-${index}`} />;
      }
      return <circle key={`lone-${line.key}-${index}`} cx={cx} cy={cy} r={2.5} fill={line.colour} stroke={CHART_COLOURS.surface} strokeWidth={1} />;
    };
  };

  const lineValue = (each) => (year) => {
    const point = lineData.find((p) => p.year === year);
    return point?.[each] ?? null;
  };
  const focusAt = (year) => {
    const point = data.find((p) => p.year === year);
    return (byMeasure ? point?.net : point?.[FOCUS]) ?? null;
  };

  const csvText = () =>
    byMeasure
      ? buildChartCsv({
          title: `Change in household net income per person, ${FOCUS_LABEL}, by policy, ${first} to ${last}`,
          units: cumulative ? "£ per person, running total from the first year" : "£ per person per year; each policy's own effect",
          columns: [
            { key: "yearLabel", label: "Year" },
            ...partKeys.map((each) => ({ key: each, label: catalogue.bySeriesKey.get(each)?.label ?? each, decimals: 2 })),
            { key: "net", label: "Net change", decimals: 2 },
          ],
          rows: barData.filter((point) => point.net !== null).map((point) => ({ ...point, yearLabel: fiscalYearTick(point.year) })),
        })
      : buildChartCsv({
          title: `Average change in household net income per person by year, ${first} to ${last}`,
          units: cumulative
            ? "£ per person, running total from the first year; the sum of each selected policy's own effect"
            : "£ per person per year; the sum of each selected policy's own effect; each person counts their household's change in net income (not equivalised)",
          columns: [
            { key: "yearLabel", label: "Year" },
            ...SERIES_LIST.map((series) => ({ key: series.key, label: series.label, decimals: 2 })),
          ],
          rows: lineData.filter((point) => point.published).map((point) => ({ ...point, yearLabel: fiscalYearTick(point.year) })),
          notes: [
            ...unpublished.map((point) => `${fiscalYearTick(point.year)}: ${NOT_YET_PUBLISHED.toLowerCase()}`),
            ...suppressed.map(
              (point) => `${fiscalYearTick(point.year)}, too few survey records: ${point.suppressed.map(labelOf).join(", ")}`,
            ),
            ...(missingNote ? [missingNote] : []),
            ...(combinationNote ? [combinationNote] : []),
          ],
        });
  const download = {
    chartRef,
    name: `young-people-change-by-year${byMeasure ? "-by-measure" : ""}${cumulative ? "-running-total" : ""}`,
    exportOptions: {
      title,
      description: headline ?? description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: byMeasure
        ? []
        : lines.filter((line) => compare === "groups" || line.strong).map((line) => ({ color: line.colour, label: line.label, type: "line", dash: line.dash })),
    },
    csv: csvText,
    published: raw.some((point) => point.published),
  };
  const yWidth = axisWidth(ticks, signedPounds);
  const margin = plotMargin(narrow, { right: byMeasure || groupsView ? 16 : narrow ? 44 : 84 });

  return (
    <div className="young-people-trend">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="trend" />
            <span className="title-text">{title}</span>
          </h3>
          <p className="chart-description">
            {/* One plain sentence, units folded in; the description only
                when there is no headline */}
            {headline ? <span className="trend-headline">{headline}</span> : description}
            {stepsLine ? ` ${stepsLine}` : null}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-controls young-people-controls">
        <ControlBar
          name={title}
          options={[
            ...extraOptions,
            { label: "Compare", value: compare, onChange: setCompare, options: compareOptions(FOCUS_LABEL) },
            { label: "Breakdown", value: view, onChange: setView, options: viewOptions(FOCUS_LABEL) },
            { label: "Years", value: years, onChange: setYears, options: YEARS_OPTIONS },
          ]}
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {combinationEverywhere ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{COMBINATION_NOT_PUBLISHED}</p>
          </div>
        ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={margin} stackOffset="sign" barCategoryGap="28%">
            <CartesianGrid {...GRID_PROPS} />
            <Customized
              component={
                <YearShading years={shownYears} selectedYear={Number(selectedYear)} unpublishedYears={unpublished.map((point) => point.year)} />
              }
            />
            <XAxis
              dataKey="year"
              type="category"
              tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
              padding={byMeasure ? undefined : narrow ? { left: 10, right: 10 } : { left: 24, right: 24 }}
              tick={narrow ? { ...TICK_STYLE, fontSize: 10 } : TICK_STYLE}
              height={X_AXIS_HEIGHT}
              // A title as Average change by age has, so the two x axes line up
              label={{ value: "Year", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tickFormatter={signedPounds}
              tick={TICK_STYLE}
              width={yWidth}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={byMeasure ? { fill: CHART_COLOURS.hover } : { stroke: CHART_COLOURS.axis }}
              content={
                <TrendTooltip
                  focusSeries={focusSeries}
                  allValue={byMeasure ? (year) => barData.find((p) => p.year === year)?.all ?? null : lineValue(ALL_BAND)}
                  groupValue={focusAt}
                  groupLabel={FOCUS_LABEL}
                  nameOf={nameOf}
                  cumulative={cumulative}
                  selectedYear={selectedYear}
                />
              }
            />
            {byMeasure &&
              partKeys.map((each) => (
                <Bar
                  key={each}
                  dataKey={each}
                  stackId="stack"
                  fill={catalogue.bySeriesKey.get(each)?.color ?? CHART_COLOURS.noChange}
                  fillOpacity={measureOpacity(key.highlight, each)}
                  isAnimationActive={false}
                  legendType="none"
                />
              ))}
            {byMeasure && (
              <Line
                type="monotoneX"
                dataKey="net"
                strokeOpacity={netOpacity(key.highlight)}
                stroke={CHART_COLOURS.net}
                strokeWidth={2}
                dot={{ r: 3.5, fill: CHART_COLOURS.net, stroke: CHART_COLOURS.surface, strokeWidth: 1.5 }}
                isAnimationActive={false}
                legendType="none"
              />
            )}
            {!byMeasure &&
              ordered.filter((line) => isShown(line.key)).map((line) => (
                <Line
                  key={line.key}
                  type="monotoneX"
                  dataKey={line.key}
                  name={line.label}
                  stroke={line.colour}
                  strokeWidth={line.width}
                  // All age groups: a hovered chip or line brings its line forward
                  strokeOpacity={
                    groupsView && hovered && hovered !== line.key ? 0.22 : line.context && hovered !== line.key ? CONTEXT_OPACITY : 1
                  }
                  strokeDasharray={line.dash}
                  dot={line.strong || compare === "groups" ? { r: line.key === FOCUS ? 4 : 2.5, fill: line.colour, stroke: CHART_COLOURS.surface, strokeWidth: 1.5, opacity: groupsView && hovered && hovered !== line.key ? 0.22 : 1 } : loneDot(line)}
                  activeDot={line.strong ? { r: 5 } : false}
                  isAnimationActive={false}
                  onMouseEnter={() => setHovered(line.key)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            {/* A wide invisible stroke over each line takes the hover */}
            {!byMeasure &&
              ordered.filter((line) => isShown(line.key)).map((line) => (
                <Line
                  key={`hit-${line.key}`}
                  type="monotoneX"
                  dataKey={line.key}
                  stroke="transparent"
                  strokeWidth={HIT_WIDTH}
                  dot={false}
                  activeDot={false}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                  onMouseEnter={() => setHovered(line.key)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            {!byMeasure && !groupsView && (
              <Customized
                component={
                  <EndLabels data={lineData} lines={lines.filter((line) => isShown(line.key))} hovered={hovered} onHover={setHovered} narrow={narrow} />
                }
              />
            )}
            {!cumulative && !phone && notes.length > 0 && (
              <Customized
                component={
                  <StepLabels
                    notes={notes}
                    valueAt={focusAt}
                    years={data.map((point) => point.year)}
                    paths={
                      byMeasure
                        ? [data.map((point) => point.net ?? null)]
                        : ordered.filter((line) => isShown(line.key)).map((line) => data.map((point) => point[line.key] ?? null))
                    }
                    columns={byMeasure ? stackColumns(data, partKeys) : []}
                    gridValues={ticks}
                  />
                }
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {/* The key, which also shows or hides each line: all age groups one
            chip each; the focus view 16 to 24, all ages and one chip for the
            other groups. The shaded year is explained in the tooltip. */}
        {groupsView && (
          <SeriesToggle
            series={lines.map((line) => ({ key: line.key, label: line.label, short: line.short, colour: line.colour, dash: line.dash }))}
            shown={shownGroups}
            onChange={setShownGroups}
            onHover={setHovered}
            label="Age groups"
            narrow={narrow}
          />
        )}
        {focusView && (
          <SeriesToggle
            // 16 to 24 and all ages first, then each other group in its
            // line's own colour and dash
            series={[
              ...lines.filter((line) => line.key === FOCUS),
              ...lines.filter((line) => line.key === ALL_BAND),
              ...lines.filter((line) => line.context),
            ].map((line) => ({ key: line.key, label: line.label, short: line.short, colour: line.colour, dash: line.dash }))}
            shown={shownFocus}
            onChange={setShownFocus}
            onHover={setHovered}
            label="Age groups"
            narrow={narrow}
          />
        )}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {/* The same foot as the card beside it, so the pair ends level */}
      <div className="chart-footer">
        {missingNote && <Note>{missingNote}</Note>}
        {combinationNote && <Note>{combinationNote}</Note>}
        {byMeasure && netOnly && <Note>{PACKAGE_NET_ONLY}</Note>}
        <ChartMoreInfo
          members={members}
          year={Number(selectedYear)}
          info={{
            caveats: [
              unpublished.length > 0 &&
                `Not yet published: ${unpublished.map((point) => fiscalYearTick(point.year)).join(", ")}.`,
            ],
            method: BY_YEAR_METHOD,
          }}
        />
      </div>
    </div>
  );
}

export default TrendCard;
