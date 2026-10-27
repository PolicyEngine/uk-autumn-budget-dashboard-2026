import { useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
  CHART_COLOURS,
  REFERENCE_DASH,
} from "../../utils/chartTheme";
import { DISPLAY_YEARS, NOT_YET_PUBLISHED } from "../../utils/displayYears";
import { X_AXIS_HEIGHT, plotMargin } from "./chartRows";
import { AGE_GROUPS, ALL_BAND, YOUNG_BAND } from "../../utils/ageImpact";
import {
  GROUP_STYLES,
  changeByYear,
  cumulate,
  groupMeasureSeries,
  niceRange,
  pounds,
  signedPounds,
  stepAnnotations,
  topParts,
} from "./youngPeopleData";
import { chartTransition } from "../../utils/chartMotion";
import { PENSIONERS, groupLabel, groupSeries, groupSubject } from "../../utils/ageGroups";
import { legendMembership } from "../../utils/legendMembership";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { shortNameOf } from "../../utils/policyDetails";
import TitleIcon from "../TitleIcon";
import ChartMoreInfo from "../ChartMoreInfo";
import { BY_YEAR_METHOD } from "../methodology/anchors";

/** Every age group's line, 16 to 24 first. */
export const SERIES = AGE_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  short: group.short,
  ...GROUP_STYLES[group.key],
}));

export const TREND_DESCRIPTION = "Average change per person, £ a year.";
const CUMULATIVE_DESCRIPTION = `Running total per person from ${fiscalYearTick(DISPLAY_YEARS[0])}, £.`;


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
  { value: "measures", label: `Measures, ${label}`, summary: "By measure" },
];
const YEARS_OPTIONS = [
  { value: "each", label: "Each year", summary: "Each year" },
  { value: "total", label: "Running total", summary: "Running total" },
];

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
export function YearShading({ xAxisMap, yAxisMap, selectedYear, unpublishedYears }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis) return null;
  const years = DISPLAY_YEARS;
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

/**
 * The measure behind each big step, in a small white label above or below
 * the focus line's point with a short leader: below a fall, above a rise,
 * moved past the £0 line rather than sitting on it, and flipped to the
 * other side when there is no room.
 */
export function StepLabels({ xAxisMap, yAxisMap, notes, valueAt, narrow }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const fontSize = narrow ? 10.5 : 11.5;
  const boxHeight = fontSize + 8;
  const top = yAxis.y + 2;
  const bottom = yAxis.y + yAxis.height - 2;
  const zero = yAxis.scale(0);
  return (
    <g className="trend-step-labels" aria-hidden="true">
      {notes.map((note) => {
        const value = valueAt(note.year);
        const x = xOf(xAxis, note.year);
        if (value === null || x === null) return null;
        const y = yAxis.scale(value);
        // An estimate of the text's width, for its box
        const width = note.text.length * fontSize * 0.56 + 12;
        const place = (below) => {
          let boxTop = below ? y + 14 : y - 14 - boxHeight;
          // Never on the £0 line: past it, in the same direction
          if (Number.isFinite(zero) && boxTop < zero + 3 && boxTop + boxHeight > zero - 3) {
            boxTop = below ? zero + 5 : zero - 5 - boxHeight;
          }
          return boxTop;
        };
        let below = note.step < 0;
        let boxTop = place(below);
        if (boxTop < top || boxTop + boxHeight > bottom) {
          below = !below;
          boxTop = Math.min(Math.max(place(below), top), bottom - boxHeight);
        }
        // Near the right edge the label ends at the point, near the left it starts there
        const right = x > xAxis.x + xAxis.width * 0.7;
        const left = x < xAxis.x + xAxis.width * 0.3;
        // (clear of the line names at the right edge)
        const boxLeft = right ? x - width - 4 : left ? x - 10 : x - width / 2;
        const leaderEnd = below ? boxTop : boxTop + boxHeight;
        return (
          <g key={note.year}>
            <line x1={x} x2={right ? x - 4 : x} y1={y + (below ? 5 : -5)} y2={leaderEnd} stroke={CHART_COLOURS.tick} strokeWidth={1} />
            <rect
              x={boxLeft}
              y={boxTop}
              width={width}
              height={boxHeight}
              rx={4}
              fill={CHART_COLOURS.surface}
              stroke={CHART_COLOURS.axis}
              strokeWidth={1}
            />
            <text
              x={boxLeft + width / 2}
              y={boxTop + boxHeight / 2}
              dy="0.35em"
              textAnchor="middle"
              fontSize={fontSize}
              fill={CHART_COLOURS.text}
              fontWeight={500}
            >
              {note.text}
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

/**
 * How the change for 16 to 24-year-olds moves year by year, against all
 * ages, with the other age groups as faint context, the measures behind
 * the biggest steps named on the line, and a breakdown by measure. Straight
 * segments between the annual points: there is nothing between them.
 */
function TrendCard({ rows, policies, selectedPolicies, selectedYear, narrow, height, group = YOUNG_BAND, extraOptions = [] }) {
  // The focus group (By age's Age group): an age band, or pensioners from
  // their single years of age, which join the lines as a series of their own
  const FOCUS = group;
  const FOCUS_LABEL = groupLabel(group);
  const SUBJECT = groupSubject(group);
  const SERIES_LIST = group === PENSIONERS ? [...SERIES, { key: PENSIONERS, label: "Pensioners", short: "Pens." }] : SERIES;
  const chartRef = useRef(null);
  const catalogue = useMeasureCatalogue();
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

  const bands = useMemo(() => changeByYear(rows, policies, selectedPolicies, DISPLAY_YEARS), [rows, policies, selectedPolicies]);
  const focusSeries = useMemo(
    () => groupSeries(rows, policies, selectedPolicies, DISPLAY_YEARS, FOCUS),
    [rows, policies, selectedPolicies, FOCUS],
  );
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
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values));

  const unpublished = raw.filter((point) => !point.published);
  const suppressed = raw.filter((point) => point.published && point.suppressed.length > 0);
  const labelOf = (each) => SERIES.find((series) => series.key === each)?.label ?? each;
  const first = fiscalYearTick(DISPLAY_YEARS[0]);
  const last = fiscalYearTick(DISPLAY_YEARS[DISPLAY_YEARS.length - 1]);
  const title = `Change by year, ${first} to ${last}`;
  const description = cumulative ? CUMULATIVE_DESCRIPTION : TREND_DESCRIPTION;

  // The headline: the selected year, then the step that changes it most
  const selected = focusSeries.find((point) => point.year === Number(selectedYear));
  const headline = (() => {
    if (cumulative) {
      const shown = focusSeries.filter((point) => point.net !== null);
      if (!shown.length) return null;
      const total = shown.reduce((sum, point) => sum + point.net, 0);
      const span = `${fiscalYearTick(shown[0].year)} to ${fiscalYearTick(shown[shown.length - 1].year)}`;
      if (Math.round(Math.abs(total)) === 0) return `${SUBJECT} see almost no change in total from ${span}.`;
      return `${SUBJECT} ${total >= 0 ? "gain" : "lose"} ${about(total)} each in total from ${span}.`;
    }
    if (!selected || selected.net === null) return null;
    const verb = selected.net >= 0 ? "gain" : "lose";
    // About £0 is no gain or loss: said as almost no change
    let text =
      Math.round(Math.abs(selected.net)) === 0
        ? `${SUBJECT} see almost no change in ${fiscalYearTick(selected.year)}`
        : `${SUBJECT} ${verb} ${about(selected.net)} a year in ${fiscalYearTick(selected.year)}`;
    // The biggest step after the selected year
    const later = notes.filter((note) => note.year > selected.year).sort((x, y) => Math.abs(y.step) - Math.abs(x.step))[0];
    if (later) {
      const flips = Math.sign(later.value) !== Math.sign(selected.net) && Math.abs(later.value) >= 1;
      text += flips
        ? `; from ${fiscalYearTick(later.year)} the ${inSentence(nameOf(later.measureId))} turns this into a ${later.value >= 0 ? "gain" : "loss"} of ${about(later.value)}`
        : `; in ${fiscalYearTick(later.year)} the ${inSentence(nameOf(later.measureId))} moves it to ${signed(later.value)}`;
    }
    return `${text}.`;
  })();

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
          title: `Change in household net income per person, ${FOCUS_LABEL}, by measure, ${first} to ${last}`,
          units: cumulative ? "£ per person, running total from the first year" : "£ per person per year; each measure's own effect",
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
            {headline ? <strong className="trend-headline">{headline}</strong> : null} {description}
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
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={margin} stackOffset="sign" barCategoryGap="28%">
            <CartesianGrid {...GRID_PROPS} />
            <Customized
              component={
                <YearShading selectedYear={Number(selectedYear)} unpublishedYears={unpublished.map((point) => point.year)} />
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
                  dot={line.strong || compare === "groups" ? { r: line.key === FOCUS ? 4 : 2.5, fill: line.colour, stroke: CHART_COLOURS.surface, strokeWidth: 1.5, opacity: groupsView && hovered && hovered !== line.key ? 0.22 : 1 } : false}
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
            {!cumulative && notes.length > 0 && (
              <Customized component={<StepLabels notes={notes} valueAt={focusAt} narrow={narrow} />} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
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
