import { useMemo, useRef, useState } from "react";
import LoadingSkeleton from "./publication/LoadingSkeleton";
import SwapTransition from "./SwapTransition";
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
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import MeasureKey, { MeasureKeyProvider, SectionMeasureKey, measureOpacity, useMeasureKey } from "./MeasureKey";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import SectionHeading from "./SectionHeading";
import Note from "./Note";
import TitleIcon from "./TitleIcon";
import ChartMoreInfo from "./ChartMoreInfo";
import { AGE_METHOD } from "./methodology/anchors";
import PensionerTrendCard from "./pensioners/PensionerTrendCard";
import { NoEffectList } from "./personal/PolicyBars";
import { DUMBBELL_MAX_STEPS, MeasureDumbbell } from "./youngPeople/MeasuresCard";
import { niceRange, pounds, signedPounds, singleAgeBars } from "./youngPeople/youngPeopleData";
import { X_AXIS_HEIGHT, plotMargin } from "./youngPeople/chartRows";
import { AGE_VIEWS, useAgeImpactRows } from "./YoungPeopleSection";
import ControlBar from "./ControlBar";
import MeasureSharesChart from "./MeasureSharesChart";
import { SHARE_FILTER_OPTIONS, filterShareRows, sharesByMeasure } from "../utils/measureShares";
import {
  PENSIONER_AGE_FIRST,
  PENSIONER_AGE_LAST,
  pensionerAge,
  pensionerMeasures,
  pensionerShares,
  pensionerSharesBySingleAge,
  pensionerTrend,
  smoothByAge,
} from "./pensioners/pensionersData";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import {
  barShape,
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
  CHART_COLOURS,
  divergingAxis,
  HOVER_CURSOR,
} from "../utils/chartTheme";
import { isPublished, singleAgeKey } from "../utils/ageImpact";
import { DISPLAY_YEARS } from "../utils/displayYears";
import { chartMotion, netDot } from "../utils/chartMotion";
import { formatShare, visibleSegments } from "../utils/shareFormat";
import {
  legendMembership,
  exportLegendItems,
  drawnNames,
} from "../utils/legendMembership";
import "./YoungPeopleSection.css";
import "./PensionersSection.css";


// The measures card's About this chart (the measures with no effect join its caveats)
const PENSIONER_MEASURES_INFO = {
  method: AGE_METHOD,
};

/** The section's anchor: link to it as #pensioners. */
export const PENSIONERS_ANCHOR = "pensioners";

const UNIT = "Average change per pensioner (£ a year)";
const AGE_UNIT = "Average change per person (£ a year)";
// The pensioners' ages and the selected year: the page's highlight tint
const HIGHLIGHT_FILL = CHART_COLOURS.highlightBand;
const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: CHART_COLOURS.gain },
  { key: "pct_unchanged", label: "Unchanged", color: CHART_COLOURS.noChange },
  { key: "pct_worse_off", label: "Worse off", color: CHART_COLOURS.loss },
];
const OUTCOME_KEYS = OUTCOMES.map((outcome) => outcome.key);
const CSV_UNITS =
  "£ per person per year; each person counts their household's change in net income (not equivalised)";

const selectedNames = (policies, selected) =>
  policies.filter((policy) => selected.includes(policy.id)).map((policy) => policy.name);

/** Each stack's lowest and highest end, for an axis over every point. */
function stackEnds(points, policies) {
  const values = [0];
  for (const point of points) {
    let up = 0;
    let down = 0;
    for (const policy of policies) {
      const value = point[policy.name] ?? 0;
      if (value > 0) up += value;
      else down += value;
    }
    values.push(up, down);
  }
  return values;
}

// The dashboard's bar style (chartTheme barShape): the 100% share bars
// round both ends
const SHARE_BAR_SHAPE = barShape(OUTCOMES.map((outcome) => outcome.key), { layout: "vertical", roundBase: true });

/** The policy bars, always mounted (a zero series has no height): the
 * catalogue's displayable measures, keyed by name as pensionersData is;
 * the others fade while one is highlighted from the key (MeasureKey). */
const policyBars = (catalogue, highlight) =>
  catalogue.displayable.map((measure) => (
    <Bar
      key={measure.id}
      dataKey={measure.name}
      name={measure.name}
      fill={measure.color}
      fillOpacity={measureOpacity(highlight, measure.seriesKey)}
      stackId="stack"
      shape={barShape(catalogue.displayable.map((item) => item.name))}
      {...chartMotion()}
    />
  ));

/** The chart's logo row. */
function Logo() {
  return (
    <div className="chart-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={CHART_LOGO.href} alt="PolicyEngine" />
    </div>
  );
}

/** A card's title row: icon, title and the download menu. */
function CardHeader({ icon, title, description, download, disabledReason }) {
  return (
    <div className="chart-header">
      <div>
        <h3>
          <TitleIcon name={icon} />
          <span className="title-text">
            <NoBreakYear text={title} />
          </span>
        </h3>
        <p className="chart-description">{description}</p>
      </div>
      <ChartDownloadMenu download={download} chartTitle={title} disabledReason={disabledReason} />
    </div>
  );
}

/** Ticks on the age axis: every five years, and the pensioner age. */
function ageTicks(year, narrow) {
  const from = pensionerAge(year);
  const every = narrow ? 10 : 5;
  const ticks = [];
  for (let age = PENSIONER_AGE_FIRST; age < PENSIONER_AGE_LAST; age += every) {
    // Never so close to the pensioner age that the two labels touch
    if (Math.abs(age - from) >= (narrow ? 4 : 2)) ticks.push(singleAgeKey(age));
  }
  ticks.push(singleAgeKey(from), singleAgeKey(PENSIONER_AGE_LAST));
  return ticks.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/** An age tick, the pensioner age in bold teal. */
function AgeTick({ x, y, payload, from }) {
  const own = payload.value === singleAgeKey(from);
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={TICK_STYLE.fontSize}
      fill={own ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={own ? 600 : 400}
    >
      {payload.value}
    </text>
  );
}

/** "+£12", "−£8", "£0": a change in pounds with a true minus. */
const changeText = (value) => {
  const rounded = Math.round(value);
  if (rounded === 0) return "£0";
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return rounded > 0 ? `+${text}` : `−${text}`;
};

/** "Age 72: +£15 a year", and the five-year average under it. */
function AgeTooltip({ active, payload }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || point.netChange === null) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        Age {point.label}: {changeText(point.netChange)} a year
      </p>
      {point.smooth !== null && (
        <p className="chart-tooltip-note">Five-year average around this age: {changeText(point.smooth)} a year</p>
      )}
    </div>
  );
}

/**
 * The average change per person by single year of age, 55 to 90 and over,
 * in the selected year: one bar per age, a gain in the gain colour and a
 * loss in the loss colour, a five-year average drawn through them so the
 * shape reads through single-year noise, and State Pension age marked. One
 * axis for every year, so Play shows the change between years.
 */
function AgeCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  const from = pensionerAge(year);
  const ageBars = (each) =>
    smoothByAge(singleAgeBars(rows, policies, selectedPolicies, each, PENSIONER_AGE_FIRST, PENSIONER_AGE_LAST));
  const data = ageBars(year);
  // Round £ ticks from the lowest to the highest change in any year shown,
  // always through £0, so the scale holds still under Play
  const { domain, ticks } = useMemo(() => {
    const values = [0];
    for (const each of DISPLAY_YEARS) {
      for (const point of ageBars(each)) {
        if (point.netChange !== null) values.push(point.netChange);
      }
    }
    return niceRange(Math.min(...values), Math.max(...values), { maxSteps: 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, policies, selectedPolicies]);
  // The measures with no effect at these ages, for More info
  const members = useMemo(
    () =>
      legendMembership(catalogue, selectedPolicies, (id) =>
        data.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, policies, selectedPolicies, year],
  );
  const missing = data.filter((point) => point.netChange === null);
  const anyLoss = data.some((point) => (point.netChange ?? 0) < 0);
  const anyGain = data.some((point) => (point.netChange ?? 0) > 0);
  const title = `Change by age, ${yearLabel}`;
  const description = "Average change per person, £ a year, by age.";
  const measureIds = [...new Set(data.flatMap((point) => point.parts.map((part) => part.id)))];
  const measureName = (id) => catalogue.byId.get(id)?.label ?? id;
  const download = {
    chartRef,
    name: `pensioners-change-by-age-${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: [
        ...(anyGain ? [{ color: CHART_COLOURS.gain, label: "Gain", type: "rect" }] : []),
        ...(anyLoss ? [{ color: CHART_COLOURS.loss, label: "Loss", type: "rect" }] : []),
        { color: CHART_COLOURS.highlight, label: "Five-year average", type: "line" },
      ],
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per person by single year of age, ${yearLabel}`,
        units: `${CSV_UNITS}; the sum of each selected policy's own effect; the five-year average is centred on each age`,
        columns: [
          { key: "label", label: "Age" },
          ...measureIds.map((id) => ({ key: id, label: measureName(id), decimals: 2 })),
          { key: "netChange", label: "Net change", decimals: 2 },
          { key: "smooth", label: "Five-year average", decimals: 2 },
        ],
        rows: published
          ? data
              .filter((point) => point.netChange !== null)
              .map((point) => ({ ...point, ...Object.fromEntries(point.parts.map((part) => [part.id, part.value])) }))
          : [],
        notes: missing.length ? [`Not shown, too few survey records: ages ${missing.map((p) => p.label).join(", ")}`] : [],
      }),
    published,
  };

  return (
    <div className="pensioners-age">
      <CardHeader icon="bars" title={title} description={description} download={download} />
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={plotMargin(narrow)} barCategoryGap="12%">
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="label"
                ticks={ageTicks(year, narrow)}
                interval={0}
                tick={<AgeTick from={from} />}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: "Age", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={changeText}
                tick={TICK_STYLE}
                width={axisWidth(ticks, changeText)}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...TOOLTIP_PROPS} cursor={HOVER_CURSOR} content={<AgeTooltip />} />
              <Bar dataKey="netChange" name="Change" isAnimationActive={false} legendType="none" shape={barShape(["netChange"])}>
                {data.map((point) => (
                  <Cell
                    key={point.label}
                    fill={(point.netChange ?? 0) < 0 ? CHART_COLOURS.loss : CHART_COLOURS.gain}
                    fillOpacity={0.55}
                  />
                ))}
              </Bar>
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
              <Line
                type="monotone"
                dataKey="smooth"
                stroke={CHART_COLOURS.highlight}
                strokeWidth={2}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                legendType="none"
              />
              {/* State Pension age: where pensioners start */}
              <ReferenceLine
                x={singleAgeKey(from)}
                stroke={CHART_COLOURS.highlight}
                strokeDasharray="4 3"
                label={{
                  value: narrow ? `Pension age ${from}` : `State Pension age, ${from}`,
                  position: "insideTopRight",
                  fill: CHART_COLOURS.highlight,
                  fontSize: TICK_STYLE.fontSize,
                  fontWeight: 600,
                }}
              />
              <Customized component={<ChartUnitLabel text={AGE_UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {published && (
          <span className="measure-dumbbell-legend age-change-legend">
            {anyGain && (
              <span>
                <i className="swatch gain" /> Gain
              </span>
            )}
            {anyLoss && (
              <span>
                <i className="swatch loss" /> Loss
              </span>
            )}
            <span>
              <i className="line" /> Five-year average
            </span>
          </span>
        )}
      </div>
      <Logo />
      {published && (
        <div className="chart-footer">
          {missing.length > 0 && (
            <Note>Not shown, as too few survey records: ages {missing.map((p) => p.label).join(", ")}.</Note>
          )}
          <ChartMoreInfo
            members={members}
            year={year}
            info={{
              how: [
                `One bar per single year of age, ${PENSIONER_AGE_FIRST} to 90 and over: the sum of each selected policy's own effect.`,
                "The line averages the five ages centred on each one, as single ages rest on few survey records.",
                `The dashed line marks State Pension age (${from} in ${yearLabel}); pensioners are the ages from it.`,
              ],
              method: AGE_METHOD,
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Each selected policy's average change per pensioner beside its all-ages
 * figure in the selected year: the Young people dumbbell, for pensioners.
 */
function MeasuresCard({ catalogue, rows, policies, selectedPolicies, selectedYear, height }) {
  const chartRef = useRef(null);
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  const { shown, noEffect, suppressed } = pensionerMeasures(rows, policies, selectedPolicies, year);
  const values = shown.flatMap((point) => [point.group, point.all]);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values), {
    maxSteps: DUMBBELL_MAX_STEPS,
  });
  const title = `Effect of each policy, ${yearLabel}`;
  const description = "Each policy's average change per person: pensioners vs all ages.";
  const notes = suppressed.length ? [`Not shown, too few survey records: ${suppressed.join(", ")}`] : [];
  // No reason per measure, as in MeasuresCard: a list of them by id would
  // be a measure list of the page's own (the catalogue carries none)
  const noEffectItems = noEffect.map((policy) => ({
    ...policy,
    color: catalogue.byId.get(policy.id)?.color ?? CHART_COLOURS.noChange,
  }));
  const download = {
    chartRef,
    name: `pensioners-change-by-policy-${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: [
        { color: CHART_COLOURS.gain, label: "Pensioners", type: "rect" },
        { color: CHART_COLOURS.reference, label: "All ages", type: "rect" },
      ],
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per person by policy, ${yearLabel}`,
        units: `£ per person per year; each policy's own effect; each person counts their household's change in net income (not equivalised); pensioners are aged ${pensionerAge(year)} and over`,
        columns: [
          { key: "name", label: "Policy" },
          { key: "group", label: "Pensioners", decimals: 2 },
          { key: "all", label: "All ages", decimals: 2 },
        ],
        rows: published ? shown : [],
        notes,
      }),
    published: published && shown.length > 0,
  };

  return (
    <div className="pensioners-measures">
      <CardHeader icon="hbars" title={title} description={description} download={download} />
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : shown.length ? (
          <MeasureDumbbell
            rows={shown}
            domain={domain}
            ticks={ticks}
            groupName="Pensioners"
            yearLabel={yearLabel}
            height={height}
          />
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>None of the selected policies changes household incomes in {yearLabel}.</p>
          </div>
        )}
      </div>
      <div className="chart-legend">
        {published && shown.length > 0 && (
          <span className="measure-dumbbell-legend">
            <span>
              <i className="dot" /> Pensioners
            </span>
            <span>
              <i className="ring" /> All ages
            </span>
          </span>
        )}
      </div>
      <Logo />
      {/* Notes and About this chart in the card's footer row, level across a pair */}
      {published && (
        <div className="chart-footer">
          {notes.length > 0 && <Note>{notes.join(". ")}.</Note>}
          <NoEffectList items={noEffectItems} title={`No effect in ${yearLabel}`} info={PENSIONER_MEASURES_INFO} />
        </div>
      )}
    </div>
  );
}

/** The split column's width, as the dumbbell's value column, and each half's. */
const SPLIT_WIDTH = 112;
const SPLIT_WIDTH_NARROW = 108;
const SPLIT_COLUMN = 58;

/** A row's better / worse split, at the bar's right: "▲ 62% ▼ <0.1%". */
function SplitTick({ x, y, payload, data, narrow }) {
  const row = data.find((point) => point.group === payload.value);
  if (!row) return null;
  // Two right-aligned columns, ▲ then ▼, ending at the axis's right edge
  // (Recharts puts x 8px into the axis), as the dumbbell's value column
  const end = x - 8 + (narrow ? SPLIT_WIDTH_NARROW : SPLIT_WIDTH);
  return (
    <text y={y} dominantBaseline="middle" fontSize={narrow ? 12 : 13} fill={CHART_COLOURS.tick} style={{ fontVariantNumeric: "tabular-nums" }}>
      <tspan x={end - SPLIT_COLUMN} textAnchor="end">
        <tspan fill={CHART_COLOURS.gain}>▲</tspan> {formatShare(row.real.pct_better_off)}
      </tspan>
      <tspan x={end} textAnchor="end">
        <tspan fill={CHART_COLOURS.loss}>▼</tspan> {formatShare(row.real.pct_worse_off)}
      </tspan>
    </text>
  );
}


/** "Aged 67", "Aged 90 and over"; a group's name as it is. */
const ageLabel = (label) =>
  /^\d+\+$/.test(label) ? `Aged ${label.slice(0, -1)} and over` : /^\d+$/.test(label) ? `Aged ${label}` : label;

/** One age per row in the single-age view: 14px bars 6px apart, plus the axis. */
const singleSharesHeight = (rows) => rows * 20 + X_AXIS_HEIGHT + 24;

/**
 * An age down the side of the single-age view, every age (the 20px rows
 * leave room for each), the pensioners' total in bold teal.
 */
function SingleAgeRowTick({ x, y, payload }) {
  const total = payload.value === "Pensioners";
  return (
    <text
      x={x - 6}
      y={y}
      textAnchor="end"
      dominantBaseline="middle"
      fontSize={13}
      fill={total ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={total ? 600 : 400}
    >
      {payload.value}
    </text>
  );
}

function SharesTooltip({ active, payload, label, yearLabel }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        {row.measure ? `${row.measure}: ${row.groupLabel.toLowerCase()}` : ageLabel(label)}, {yearLabel}
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

/**
 * The share of pensioners better off, unchanged and worse off, beside
 * people under State Pension age and all ages, from one run (a single
 * policy, or all of them).
 */
export function PensionerSharesCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height, extraOptions = [] }) {
  const chartRef = useRef(null);
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  // By group (pensioners, under State Pension age, all ages) or by single
  // year of age from State Pension age, as Young people's card
  const [view, setView] = useState("band");
  // With no run for the whole selection: one row per measure, its own
  // shares for one group (pensioners first), filtered in the Options pill
  const [groupKey, setGroupKey] = useState("pensioners");
  const [hide, setHide] = useState("hide");
  const [order, setOrder] = useState("size");
  const [direction, setDirection] = useState("both");
  const perMeasure = sharesByMeasure(pensionerShares, rows, policies, selectedPolicies, year, catalogue.combinedId, groupKey);
  const groupLabel = perMeasure?.groups.find((group) => group.key === groupKey)?.label ?? "Pensioners";
  const filtered = perMeasure ? filterShareRows(perMeasure.rows, { hide, order, direction }) : null;
  const single = !perMeasure && view === "single";
  const from = pensionerAge(year);
  const shares = perMeasure ? null : (single ? pensionerSharesBySingleAge : pensionerShares)(rows, policies, selectedPolicies, year, catalogue.combinedId);
  const data = perMeasure
    ? filtered.rows.map((row) =>
        visibleSegments(
          {
            group: row.name,
            key: row.id,
            measure: row.name,
            groupLabel,
            ...Object.fromEntries(OUTCOME_KEYS.map((key) => [key, row.row[key]])),
          },
          OUTCOME_KEYS,
        ),
      )
    : shares
    ? shares.groups
        .filter((group) => !group.suppressed)
        .map((group) =>
          visibleSegments(
            { group: group.label, key: group.key, ...Object.fromEntries(OUTCOME_KEYS.map((key) => [key, group.row[key]])) },
            OUTCOME_KEYS,
          ),
        )
    : [];
  const thin = shares ? shares.groups.filter((group) => group.suppressed) : [];
  const title = `Better and worse off, ${yearLabel}`;
  const description = perMeasure
    ? `Share of people better or worse off (a change over 0.01%), ${groupLabel.toLowerCase()}, each selected measure on its own.`
    : single
    ? `Share of people better or worse off (a change over 0.01%), by single year of age from State Pension age (${from}) to 90 and over, then all pensioners.`
    : "Share of people better or worse off (a change over 0.01%): pensioners, people under State Pension age and all ages.";
  const download = {
    chartRef,
    name: `pensioners-better-worse-off-${single ? "single-age-" : ""}${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: OUTCOMES.map((outcome) => ({ color: outcome.color, label: outcome.label, type: "rect" })),
    },
    csv: () =>
      buildChartCsv({
        title: perMeasure
          ? `People better off, unchanged and worse off, ${groupLabel.toLowerCase()}, each measure on its own, ${yearLabel}`
          : single
          ? `People better off, unchanged and worse off by single year of age, pensioners, ${yearLabel}`
          : `People better off, unchanged and worse off, pensioners and others, ${yearLabel}`,
        units: `% of people in the group; a change of more than 0.01% of household net income; pensioners are aged ${pensionerAge(year)} and over`,
        columns: [
          { key: "group", label: perMeasure ? "Measure" : single ? "Age" : "Group" },
          ...OUTCOMES.map((outcome) => ({ key: outcome.key, label: `${outcome.label} (%)`, decimals: 2 })),
        ],
        rows: data.map((row) => ({ group: row.group, measure: row.measure, groupLabel: row.groupLabel, ...row.real })),
        notes: thin.length
          ? [`Not shown, too few survey records: ${thin.map((group) => ageLabel(group.label)).join(", ")}`]
          : [],
      }),
    published: data.length > 0,
  };

  return (
    <div className="pensioners-shares">
      <CardHeader
        icon="users"
        title={title}
        description={description}
        download={download}
      />
      <div className="chart-controls young-people-controls">
        {perMeasure ? (
          <ControlBar
            name={title}
            options={[
              ...extraOptions,
              {
                label: "Group",
                value: groupKey,
                onChange: setGroupKey,
                options: perMeasure.groups.map((group) => ({ value: group.key, label: group.label })),
              },
              { label: "Measures with no effect", value: hide, onChange: setHide, options: SHARE_FILTER_OPTIONS.hide, omitAtDefault: "hide" },
              { label: "Order", value: order, onChange: setOrder, options: SHARE_FILTER_OPTIONS.order },
              { label: "Show", value: direction, onChange: setDirection, options: SHARE_FILTER_OPTIONS.direction },
            ]}
          />
        ) : (
          <ControlBar name={title} options={[...extraOptions, { label: "Show", value: view, onChange: setView, options: AGE_VIEWS }]} />
        )}
      </div>
      <SwapTransition swapKey={view} ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : data.length && single ? (
          // One 100% bar per age from State Pension age, then the
          // pensioners' total; the ▲/▼ split at the right as in the group view
          <ResponsiveContainer width="100%" height={singleSharesHeight(data.length)}>
            <BarChart data={data} layout="vertical" margin={plotMargin(narrow)} barCategoryGap={3} barSize={11}>
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={narrow ? [0, 50, 100] : [0, 25, 50, 75, 100]}
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
                tick={<SingleAgeRowTick />}
                width={narrow ? 90 : 96}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                yAxisId="split"
                orientation="right"
                type="category"
                dataKey="group"
                tick={<SplitTick data={data} narrow={narrow} />}
                width={narrow ? SPLIT_WIDTH_NARROW : SPLIT_WIDTH}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <Tooltip {...TOOLTIP_PROPS} cursor={HOVER_CURSOR} content={<SharesTooltip yearLabel={yearLabel} />} />
              {OUTCOMES.map((outcome) => (
                <Bar key={outcome.key} dataKey={outcome.key} name={outcome.label} fill={outcome.color} stackId="share" shape={SHARE_BAR_SHAPE} {...chartMotion()} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : perMeasure && data.length ? (
          <MeasureSharesChart rows={filtered.rows} groupLabel={groupLabel} yearLabel={yearLabel} />
        ) : data.length ? (
          // The one run's groups, as the per-measure view: names, a 100% bar
          // and the ▲/▼ shares in two fixed columns
          <MeasureSharesChart
            rows={shares.groups.filter((group) => !group.suppressed).map((group) => ({ id: group.key, name: group.label, row: group.row }))}
            groupLabel=""
            yearLabel={yearLabel}
            emphasis={null}
            labelFor={({ name }) => `${name}, ${yearLabel}`}
          />
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>No shares are published for this selection in {yearLabel}.</p>
          </div>
        )}
      </SwapTransition>
      <div className="chart-legend">
        {data.length > 0 && (
          <div className="grouped-legend is-row">
            <ul className="grouped-legend-row">
              {OUTCOMES.map((item) => (
                <li key={item.key} className="grouped-legend-item">
                  <span className="grouped-legend-swatch" style={{ background: item.color }} aria-hidden="true" />
                  <span className="grouped-legend-label">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Logo />
      <div className="chart-footer">
        {published && thin.length > 0 && (
          <Note>Not shown, as too few survey records: {thin.map((group) => ageLabel(group.label)).join(", ")}.</Note>
        )}
        {filtered?.hidden > 0 && (
          <Note>
            {filtered.hidden} {filtered.hidden === 1 ? "measure" : "measures"} with no effect hidden
          </Note>
        )}
        {/* The same foot as the card beside it, so the pair ends level */}
        <ChartMoreInfo
          year={Number(selectedYear)}
          info={{
            how: perMeasure
              ? [
                  "No published run covers this selection together, so each row is one measure simulated on its own.",
                  "The rows' shares can't be added up across measures.",
                ]
              : ["Shares come from one run of the whole selection, so they include how the measures interact."],
            caveats: [
              perMeasure?.missing.length > 0 && `Not shown, too few survey records: ${perMeasure.missing.join(", ")}.`,
            ],
            method: AGE_METHOD,
          }}
        />
      </div>
    </div>
  );
}

/**
 * "Pensioners": how the selected policies change household incomes for
 * people at or over State Pension age, from the single years of age in
 * public/data/age_impact.csv (pensioners/pensionersData.js). It follows the
 * page's policy and year pills, and links to the pensioner example
 * household on Household impact.
 *
 * @param {Object} props
 * @param {Array<string>} props.selectedPolicies
 * @param {number} props.selectedYear
 * @param {Array<{id: string, name: string}>} props.policies
 */
function PensionersSection({ selectedPolicies, selectedYear, policies }) {
  const narrow = useNarrowViewport();
  const catalogue = useMeasureCatalogue();
  const { status, rows: publishedRows } = useAgeImpactRows(catalogue);
  const rows = useMemo(() => publishedRows?.filter((row) =>
    isCatalogueRowDisplayable(catalogue, row.reform_id, row.year),
  ) ?? null, [publishedRows, catalogue]);
  const props = { rows, policies, selectedPolicies, selectedYear, narrow, catalogue };
  if (status !== "ready") {
    return (
      status === "loading" ? (
        <LoadingSkeleton label="Loading results by age…" />
      ) : (
        <p className="view-status" role="status">Results by age are not available.</p>
      )
    );
  }
  return (
    <>
      <SectionHeading
        id={PENSIONERS_ANCHOR}
        icon="armchair"
        title="Change for pensioners"
        subtitle="Pensioners are people at State Pension age or over (67 from 2027-28)."
      />
      {/* Both cards colour by measure: one key above the pair, not a long
          legend in each */}
      <MeasureKeyProvider>
        <section className="report-section young-people-section" aria-label="Change for pensioners">
          <SectionMeasureKey />
          <div className="charts-grid">
            <PensionerTrendCard {...props} height={narrow ? 340 : 400} />
            <AgeCard {...props} height={narrow ? 340 : 400} />
          </div>
        </section>
      </MeasureKeyProvider>
      <SectionHeading
        id="pensioners-who-gains"
        icon="userPlus"
        title="Who gains and from what"
        subtitle="Which policies drive the change for pensioners, and how many are better or worse off."
      />
      <section className="report-section young-people-section" aria-label="Who gains and from what">
        <div className="charts-grid">
          <MeasuresCard {...props} height={narrow ? 460 : 400} />
          <PensionerSharesCard {...props} height={narrow ? 260 : 400} />
        </div>
      </section>
    </>
  );
}

export default PensionersSection;
