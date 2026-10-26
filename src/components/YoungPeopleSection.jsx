import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Scatter,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { parseTable } from "../utils/publication/csv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import SectionHeading from "./SectionHeading";
import { formatShare, visibleSegments } from "../utils/shareFormat";
import { getPolicyColor } from "../utils/policyConfig";
import Note from "./Note";
import PillSelect from "./PillSelect";
import MeasuresCard from "./youngPeople/MeasuresCard";
import TrendCard from "./youngPeople/TrendCard";
import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
} from "../utils/policyConfig";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  fiscalYearTick,
  CHART_COLOURS,
  zeroBasedAxis,
  HOVER_CURSOR,
} from "../utils/chartTheme";
import {
  AGE_BANDS,
  YOUNG_BAND,
  isPublished,
  meanChangeByBand,
  sharesByGroup,
} from "../utils/ageImpact";
import { SINGLE_AGE_FIRST, SINGLE_AGE_LAST, fitRange, sharesBySingleAge, singleAgeBars } from "./youngPeople/youngPeopleData";
import { X_AXIS_HEIGHT, plotMargin } from "./youngPeople/chartRows";
import "./YoungPeopleSection.css";
import { chartMotion, netDot } from "../utils/chartMotion";
import TitleIcon from "./TitleIcon";
import ZeroMeasuresNote from "./ZeroMeasuresNote";
import {
  legendMembership,
  legendItems as membershipItems,
  exportLegendItems,
  drawnNames,
} from "../utils/legendMembership";

/** The section's anchor: link to it as #young-people. */
export const YOUNG_PEOPLE_ANCHOR = "young-people";

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/age_impact.csv`;

// Highlight for the 16 to 24 band, and its legend swatch (the same tint
// on white)
const YOUNG_FILL = CHART_COLOURS.highlightBand;
const YOUNG_SWATCH = CHART_COLOURS.highlightBand;
// Better off, unchanged, worse off: the page's teal and amber, grey between
const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: CHART_COLOURS.gain },
  { key: "pct_unchanged", label: "Unchanged", color: CHART_COLOURS.noChange },
  { key: "pct_worse_off", label: "Worse off", color: CHART_COLOURS.loss },
];

const MEAN_DESCRIPTION =
  "Average change per person, £ a year, by age group; bars add each policy's own effect.";
const SINGLE_AGE_DESCRIPTION =
  `Average change per person, £ a year, by single year of age (${SINGLE_AGE_FIRST} to ${SINGLE_AGE_LAST}); bars add each policy's own effect.`;
const SHARES_DESCRIPTION =
  "Share of people better or worse off (a change over 0.01%), by age group.";
const SHARES_SINGLE_DESCRIPTION =
  "Share of people better or worse off (a change over 0.01%), by single year of age (10 to 40).";

/** The two views of "Average change by age". */
const AGE_VIEWS = [
  { value: "band", label: "By age group" },
  { value: "single", label: "By single year of age" },
];
// Ticks every five years, with the 16 to 24 band's ends (in bold) in place
// of 15 and 25: a bar apart, both labels would run together
const SINGLE_AGE_TICKS = ["10", "16", "20", "24", "30", "35", "40"];
const SINGLE_AGE_TICKS_NARROW = ["10", "16", "24", "30", "40"];
const YOUNG_ENDS = new Set(["16", "24"]);
// Gains teal, losses amber, under £1 either way grey (as the household
// scatter)
const SIGN_COLOURS = { gain: CHART_COLOURS.gain, loss: CHART_COLOURS.loss, zero: CHART_COLOURS.noChange };
const signColour = (value) =>
  Math.abs(value) < 1 ? SIGN_COLOURS.zero : value > 0 ? SIGN_COLOURS.gain : SIGN_COLOURS.loss;
const UNIT = "Average change per person (£ a year)";

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const signedPounds = (value) =>
  value < 0 ? `-£${Math.abs(Math.round(value)).toLocaleString("en-GB")}` : pounds(value);
const percent = formatShare;
const OUTCOME_KEYS = ["pct_better_off", "pct_unchanged", "pct_worse_off"];

/** A row's better / worse split, at the bar's right: "▲ 62% ▼ <0.1%". */
function SplitTick({ x, y, payload, data, narrow }) {
  const row = data.find((point) => point.group === payload.value);
  if (!row) return null;
  return (
    <text x={x + 4} y={y} dominantBaseline="middle" fontSize={narrow ? 10 : 11} fill={CHART_COLOURS.tick}>
      <tspan fill={CHART_COLOURS.gain}>▲</tspan>
      {` ${formatShare(row.real.pct_better_off)}  `}
      <tspan fill={CHART_COLOURS.loss}>▼</tspan>
      {` ${formatShare(row.real.pct_worse_off)}`}
    </text>
  );
}

/** The real shares of a hovered group, each to the page's rule. */
function SharesTooltip({ active, payload, label, yearLabel }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        {label === "All ages" ? label : `Aged ${String(label).toLowerCase()}`}, {yearLabel}
      </p>
      {OUTCOMES.map((outcome) => (
        <p key={outcome.key} className="chart-tooltip-row">
          <span className="chart-tooltip-swatch" style={{ background: outcome.color }} aria-hidden="true" />
          {outcome.label} {formatShare(row.real[outcome.key])}
        </p>
      ))}
    </div>
  );
}


/** Load age_impact.csv once per mount, typed by the publication contract. */
function useAgeImpactRows() {
  const [state, setState] = useState({ status: "loading", rows: null });
  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`age_impact.csv: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setState({ status: "ready", rows: parseTable("age_impact", text) });
      })
      .catch((error) => {
        console.error("Error loading results by age:", error);
        if (!cancelled) setState({ status: "error", rows: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** A legend of one row of swatches, in the grouped legend's style. */
function RowLegend({ items = OUTCOMES }) {
  return (
    <div className="grouped-legend is-row">
      <ul className="grouped-legend-row">
        {items.map((item) => (
          <li key={item.key} className="grouped-legend-item">
            <span
              className="grouped-legend-swatch"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <span className="grouped-legend-label">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SINGLE_AGE_LEGEND = [
  { key: "gain", label: "Gain", color: SIGN_COLOURS.gain },
  { key: "loss", label: "Loss", color: SIGN_COLOURS.loss },
  { key: "young", label: "16 to 24 shaded", color: YOUNG_SWATCH },
];

/** The 16 to 24 tick in bold, the others as usual. */
function AgeTick({ x, y, payload, narrow }) {
  const band = AGE_BANDS.find((candidate) => candidate.label === payload.value);
  const young = band?.key === YOUNG_BAND;
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {narrow ? band?.short : payload.value}
    </text>
  );
}

/** A stable axis for the band view, over every year: from the lowest to the
 * highest stack, always including 0, not mirrored about it. */
function useBandDomain(rows, policies, selectedPolicies) {
  return useMemo(() => {
    const years = [...new Set((rows ?? []).map((row) => row.year))];
    let lo = 0;
    let hi = 0;
    for (const year of years) {
      for (const point of meanChangeByBand(rows, policies, selectedPolicies, year)) {
        let up = 0;
        let down = 0;
        for (const policy of policies) {
          const value = point[policy.name] ?? 0;
          if (value > 0) up += value;
          else down += value;
        }
        hi = Math.max(hi, up);
        lo = Math.min(lo, down);
      }
    }
    return zeroBasedAxis([lo, hi]);
  }, [rows, policies, selectedPolicies]);
}

/** The single-year tick: the 16 to 24 band's ends in bold teal. */
function SingleAgeTick({ x, y, payload }) {
  const young = YOUNG_ENDS.has(payload.value);
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {payload.value}
    </text>
  );
}

/**
 * An age down the side of the horizontal single-age chart: every age on a
 * wide screen, every second one on a narrow one, 16 and 24 always, in bold
 * teal across the young band.
 */
function SingleAgeRowTick({ x, y, payload, narrow }) {
  const age = Number(payload.value);
  const young = age >= 16 && age <= 24;
  if (narrow && age % 2 === 1 && !YOUNG_ENDS.has(payload.value)) return null;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {payload.value}
    </text>
  );
}

// 13px bars 4px apart, plus the axis
const singleSharesHeight = (rows) => rows * 17 + X_AXIS_HEIGHT + 24;

/** "Age 22: +£X a year", the swatch in the bar's colour. */
/** An age's net change, then each policy's own part of it, largest first. */
function SingleAgeTooltip({ active, payload, yearLabel }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || point.netChange === null) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        Age {point.label}, {yearLabel}
      </p>
      <p className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ background: signColour(point.netChange) }} aria-hidden="true" />
        <strong>Net change {signedPounds(point.netChange)} a year</strong>
      </p>
      {point.parts.length > 1 &&
        point.parts
          .filter((part) => Math.round(part.value) !== 0)
          .map((part) => (
            <p key={part.id} className="chart-tooltip-row">
              <span className="chart-tooltip-swatch" style={{ background: getPolicyColor(part.id) }} aria-hidden="true" />
              {part.name} {signedPounds(part.value)}
            </p>
          ))}
    </div>
  );
}

function MeanChangeCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const [view, setView] = useState("band");
  const single = view === "single";
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const data = meanChangeByBand(rows, policies, selectedPolicies, selectedYear);
  const singleData = singleAgeBars(rows, policies, selectedPolicies, selectedYear);
  const bandAxis = useBandDomain(rows, policies, selectedPolicies);
  // The single-year axis fits the year shown's stacks, gains above zero and
  // losses below, with a little headroom (never mirrored)
  const stackEnds = singleData
    .filter((point) => point.netChange !== null)
    .map((point) => point.parts.reduce(
      ([low, high], part) => (part.value < 0 ? [low + part.value, high] : [low, high + part.value]),
      [0, 0],
    ));
  const singleAxis = fitRange(
    Math.min(0, ...stackEnds.map(([low]) => low)),
    Math.max(0, ...stackEnds.map(([, high]) => high)),
  );
  // A policy's part too small to see is drawn as a thin sliver (its real
  // value stays in the tooltip)
  const sliver = (singleAxis.domain[1] - singleAxis.domain[0]) * 0.006;
  const singleDrawn = singleData.map((point) => {
    const drawn = { ...point };
    for (const part of point.parts) {
      if (part.value !== 0 && Math.abs(part.value) < sliver) drawn[part.name] = Math.sign(part.value) * sliver;
    }
    return drawn;
  });
  const { domain, ticks } = single ? singleAxis : bandAxis;

  // Every selected measure is in the legend in every year (so the legend,
  // and the plot's height, hold still on a year change or Play); one with
  // no effect at any age this year is greyed out, and the note under the
  // chart says why (legendMembership)
  const members = useMemo(() => {
    const points = meanChangeByBand(rows, policies, selectedPolicies, selectedYear);
    const nameOf = (id) => policies.find((policy) => policy.id === id)?.name;
    return legendMembership(selectedPolicies, (id) =>
      points.some((point) => Math.abs(point[nameOf(id)] ?? 0) > 0),
    );
  }, [rows, policies, selectedPolicies, selectedYear]);
  const activeNames = drawnNames(members);
  const youngLabel = AGE_BANDS.find((band) => band.key === YOUNG_BAND).label;
  const suppressed = data.filter((point) => point.suppressed);
  const missingAges = singleData.filter((point) => point.netChange === null);
  const description = single ? SINGLE_AGE_DESCRIPTION : MEAN_DESCRIPTION;

  const title = `Average change by age, ${yearLabel}`;
  const exportName = single
    ? `young-people-change-by-single-age-${selectedYear}`
    : `young-people-change-by-age-${selectedYear}`;
  const exportOptions = {
    title,
    description,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: [
          ...exportLegendItems(members),
          ...(activeNames.length > 1
            ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }]
            : []),
    ],
  };
  const selectedNames = policies
    .filter((policy) => selectedPolicies.includes(policy.id))
    .map((policy) => policy.name);
  const units =
    "£ per person per year; each person counts their household's change in net income (not equivalised)";
  const csvText = () =>
    single
      ? buildChartCsv({
          title: `Average change in household net income per person by single year of age, ${yearLabel}`,
          units: `${units}; the sum of each selected policy's own effect`,
          columns: [
            { key: "label", label: "Age" },
            ...selectedNames.map((name) => ({ key: name, label: name, decimals: 2 })),
            { key: "netChange", label: "Net change", decimals: 2 },
          ],
          // The real values, not the slivers drawn
          rows: published ? singleData.filter((point) => point.netChange !== null) : [],
          notes: missingAges.length
            ? [`Not shown, too few survey records: ages ${missingAges.map((p) => p.label).join(", ")}`]
            : [],
        })
      : buildChartCsv({
          title: `Average change in household net income per person by age, ${yearLabel}`,
          units,
          columns: [
            { key: "label", label: "Age" },
            ...selectedNames.map((name) => ({ key: name, label: name, decimals: 2 })),
            { key: "netChange", label: "Net change", decimals: 2 },
          ],
          rows: published ? data.filter((point) => !point.suppressed) : [],
          notes: suppressed.length
            ? [`Not shown, too few survey records: ${suppressed.map((p) => p.label).join(", ")}`]
            : [],
        });
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: csvText,
    published,
  };
  const notShown = single
    ? missingAges.length > 0 && `ages ${missingAges.map((p) => p.label).join(", ")}`
    : suppressed.length > 0 && suppressed.map((p) => p.label).join(", ");

  return (
    <div className="young-people-mean">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="users" />
            <span className="title-text">
              <NoBreakYear text={title} />
            </span>
          </h3>
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-controls young-people-controls">
        <PillSelect
          variant="light"
          prefix="Show"
          name="Average change by age shown"
          value={view}
          onChange={setView}
          options={AGE_VIEWS}
          stableWidth
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : single ? (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={singleDrawn} margin={plotMargin(narrow)} barCategoryGap="14%" stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1="16" x2="24" fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="label"
                ticks={narrow ? SINGLE_AGE_TICKS_NARROW : SINGLE_AGE_TICKS}
                interval={0}
                tick={<SingleAgeTick />}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: "Age", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                width={axisWidth(ticks, signedPounds)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.text} strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={<SingleAgeTooltip yearLabel={yearLabel} />}
              />
              {/* Each policy's own part, gains stacked above zero and losses
                  below, in the policy colours */}
              {ALL_POLICY_NAMES.map((name) => (
                <Bar key={name} dataKey={name} name={name} fill={POLICY_COLORS[name]} stackId="stack" {...chartMotion()} />
              ))}
              {/* The net change: a dark dot per age */}
              <Scatter
                dataKey="netChange"
                shape={netDot}
                legendType="none"
                tooltipType="none"
                {...chartMotion()}
              />
              <Customized component={<ChartUnitLabel text={UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={plotMargin(narrow)} stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1={youngLabel} x2={youngLabel} fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="label"
                tick={<AgeTick narrow={narrow} />}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                height={X_AXIS_HEIGHT}
                label={{ value: "Age group", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                width={axisWidth(ticks, signedPounds)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.text} strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={
                  <ChartTooltip
                    format={pounds}
                    labelFormat={(label) => `Aged ${label.toLowerCase()}, ${yearLabel}`}
                    netKey="netChange"
                    netLabel="Net change"
                  />
                }
              />
              {ALL_POLICY_NAMES.map((name) => (
                <Bar
                  key={name}
                  dataKey={name}
                  name={name}
                  fill={POLICY_COLORS[name]}
                  stackId="stack"
                  {...chartMotion()}
                  // Always mounted (a zero series has no height), so a series that
                  // starts in a later year grows in place instead of remounting
                />
              ))}
              <Line
                // A smooth net line that never overshoots its points (monotone)
                type="monotone"
                strokeLinejoin="round"
                strokeLinecap="round"
                dataKey="netChange"
                name="netChange"
                stroke={CHART_COLOURS.net}
                strokeWidth={2}
                dot={false}
                {...chartMotion()}
                hide={activeNames.length <= 1}
              />
              {/* The net dots as a Scatter: Recharts hides a Line's own dots while
                  it animates, so they would vanish and pop back on every year
                  change; a Scatter's points tween with the line instead */}
              <Scatter
                dataKey="netChange"
                shape={netDot}
                legendType="none"
                tooltipType="none"
                {...chartMotion()}
                hide={activeNames.length <= 1}
              />
              <Customized component={<ChartUnitLabel text={UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {published &&
          <GroupedLegend items={membershipItems(members)} netLabel={activeNames.length > 1 ? "Net change" : undefined} />}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && <ZeroMeasuresNote members={members} year={selectedYear} />}
      {published && notShown && <Note>Not shown, as too few survey records: {notShown}.</Note>}
      {published && single && (
        <p className="chart-footnote">
          Single years of age rest on fewer households; a few large changes, such as capital gains under
          Business Asset Disposal Relief, can move one age&apos;s average.
        </p>
      )}
    </div>
  );
}

/** The group tick: 16 to 24 in bold, all ages after a gap, as usual. */
function GroupTick({ x, y, payload, narrow }) {
  const band = AGE_BANDS.find((candidate) => candidate.label === payload.value);
  const young = band?.key === YOUNG_BAND;
  const label = narrow ? (band ? band.short : "All") : payload.value;
  return (
    <text
      x={x - 6}
      y={y}
      textAnchor="end"
      dominantBaseline="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={young ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={young || !band ? 600 : 400}
    >
      {label}
    </text>
  );
}

function SharesCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  // By age group or by single year of age, as "Average change by age"
  const [view, setView] = useState("band");
  const single = view === "single";
  const description = single ? SHARES_SINGLE_DESCRIPTION : SHARES_DESCRIPTION;
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const shares = (single ? sharesBySingleAge : sharesByGroup)(rows, policies, selectedPolicies, selectedYear);
  const data = shares
    ? shares.groups
        .filter((group) => !group.suppressed)
        // Real shares kept on the row; a tiny non-zero share drawn at a
        // visible minimum width
        .map((group) => visibleSegments({ group: group.label, key: group.key, ...pick(group.row) }, OUTCOME_KEYS))
    : [];
  const thin = shares ? shares.groups.filter((group) => group.suppressed) : [];

  const title = `Better and worse off, ${yearLabel}`;
  const exportName = `young-people-better-worse-off-${single ? "single-age-" : ""}${selectedYear}`;
  const exportOptions = {
    title,
    description,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: OUTCOMES.map((outcome) => ({
      color: outcome.color,
      label: outcome.label,
      type: "rect",
    })),
  };
  const csvText = () =>
    buildChartCsv({
      title: `People better off, unchanged and worse off by ${single ? "single year of age" : "age group"}, ${yearLabel}`,
      units: "% of people in the group; a change of more than 0.01% of household net income",
      columns: [
        { key: "group", label: single ? "Age" : "Age group" },
        ...OUTCOMES.map((outcome) => ({
          key: outcome.key,
          label: `${outcome.label} (%)`,
          decimals: 2,
        })),
      ],
      // The real shares, not the widened ones drawn
      rows: data.map((row) => ({ group: row.group, ...row.real })),
      notes: thin.length
        ? [`Not shown, too few survey records: ${thin.map((group) => group.label).join(", ")}`]
        : [],
    });
  // Until the year is published, only its CSV (the menu says why otherwise)
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: csvText,
    published: data.length > 0,
  };

  return (
    <div className="young-people-shares">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="users" />
            <span className="title-text">
              <NoBreakYear text={title} />
            </span>
          </h3>
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={title}
          disabledReason={
            shares || !published ? undefined : "Choose one policy or all policies"
          }
        />
      </div>
      <div className="chart-controls young-people-controls">
        <PillSelect
          variant="light"
          prefix="Show"
          name="Better and worse off shown"
          value={view}
          onChange={setView}
          options={AGE_VIEWS}
          stableWidth
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : data.length && single ? (
          // One 100% bar per age, ages down the side as in the age-group
          // view, 16 to 24 shaded; the split is in the tooltip at this
          // density
          <ResponsiveContainer width="100%" height={singleSharesHeight(data.length)}>
            <BarChart
              data={data}
              layout="vertical"
              margin={plotMargin(narrow)}
              barCategoryGap={4}
              barSize={13}
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <ReferenceArea y1="16" y2="24" fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: "Share of people", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                type="category"
                dataKey="group"
                tick={<SingleAgeRowTick narrow={narrow} />}
                width={36}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={<SharesTooltip yearLabel={yearLabel} />}
              />
              {OUTCOMES.map((outcome) => (
                <Bar
                  key={outcome.key}
                  dataKey={outcome.key}
                  name={outcome.label}
                  fill={outcome.color}
                  stackId="share"
                  {...chartMotion()}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : data.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={plotMargin(narrow)}
              barCategoryGap="22%"
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              {/* The 16 to 24 row's highlight, as in "Average change by age" */}
              <ReferenceArea
                y1={AGE_BANDS.find((band) => band.key === YOUNG_BAND).label}
                y2={AGE_BANDS.find((band) => band.key === YOUNG_BAND).label}
                fill={YOUNG_FILL}
                ifOverflow="visible"
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{
                  value: "Share of people in the group",
                  position: "insideBottom",
                  offset: 0,
                  style: AXIS_TITLE_STYLE,
                }}
              />
              <YAxis
                type="category"
                dataKey="group"
                tick={<GroupTick narrow={narrow} />}
                width={narrow ? 52 : 96}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              {/* Each row's better / worse split, at its right */}
              <YAxis
                yAxisId="split"
                orientation="right"
                type="category"
                dataKey="group"
                tick={<SplitTick data={data} narrow={narrow} />}
                width={narrow ? 108 : 112}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={<SharesTooltip yearLabel={yearLabel} />}
              />
              {OUTCOMES.map((outcome) => (
                <Bar
                  key={outcome.key}
                  dataKey={outcome.key}
                  name={outcome.label}
                  fill={outcome.color}
                  stackId="share"
                  {...chartMotion()}
                >
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>
              These shares come from one simulation of the selected policies
              together, so they are shown for a single policy or for all
              policies.
            </p>
          </div>
        )}
      </div>
      <div className="chart-legend">{data.length > 0 && <RowLegend />}</div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && thin.length > 0 && (
        <Note>Not shown, as too few survey records: {thin.map((group) => group.label).join(", ")}.</Note>
      )}
    </div>
  );
}

const pick = (row) =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome.key, row[outcome.key]]));

/**
 * "Young people (16 to 24)": how the selected policies change household
 * incomes by age group (ONS age bands) and single year of age, with young
 * people aged 16 to 24 highlighted. It loads
 * public/data/age_impact.csv itself and follows the page's policy and
 * year pills.
 */
function YoungPeopleSection({ selectedPolicies, selectedYear, policies }) {
  const narrow = useNarrowViewport();
  const { status, rows } = useAgeImpactRows();

  // A link to #young-people: the section renders after the page's data
  // loads, too late for the browser's own jump, so scroll once it is here.
  const scrolled = useRef(false);
  useEffect(() => {
    if (status !== "ready" || scrolled.current) return;
    scrolled.current = true;
    if (typeof window !== "undefined" && window.location.hash === `#${YOUNG_PEOPLE_ANCHOR}`) {
      document.getElementById(YOUNG_PEOPLE_ANCHOR)?.scrollIntoView();
    }
  }, [status]);

  const props = { rows, policies, selectedPolicies, selectedYear, narrow };
  return (
    <>
      {/* Two sections of two cards each, as All households pairs its
          cards; the sub-tab's name says what the view is */}
      {status === "ready" ? (
        <>
          <SectionHeading
            id={YOUNG_PEOPLE_ANCHOR}
            title="Change by age"
            subtitle="How household net income changes for each age group, in the selected year and over time."
          />
          <section className="report-section young-people-section" aria-label="Change by age">
            <div className="charts-grid">
              <MeanChangeCard {...props} height={narrow ? 360 : 400} />
              <TrendCard {...props} height={narrow ? 340 : 400} />
            </div>
          </section>
          <SectionHeading
            title="Who gains and from what"
            subtitle="Which policies drive the change for young people, and how many people are better or worse off."
          />
          <section className="report-section young-people-section" aria-label="Who gains and from what">
            <div className="charts-grid">
              <MeasuresCard {...props} height={narrow ? 460 : 400} />
              <SharesCard {...props} height={narrow ? 340 : 400} />
            </div>
          </section>
        </>
      ) : (
        <p className="view-status" role="status">
          {status === "loading" ? "Loading results by age…" : "Results by age are not available."}
        </p>
      )}
    </>
  );
}

export default YoungPeopleSection;
