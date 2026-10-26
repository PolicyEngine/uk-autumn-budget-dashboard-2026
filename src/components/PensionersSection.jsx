import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { NoEffectList } from "./personal/PolicyBars";
import { DUMBBELL_MAX_STEPS, MeasureDumbbell } from "./youngPeople/MeasuresCard";
import { niceRange, pounds, signedPounds, singleAgeBars } from "./youngPeople/youngPeopleData";
import { X_AXIS_HEIGHT, plotMargin } from "./youngPeople/chartRows";
import { AGE_VIEWS, useAgeImpactRows } from "./YoungPeopleSection";
import ControlBar from "./ControlBar";
import { MeasureGroupTick } from "./MeasureShareTick";
import { sharesByMeasureAllGroups } from "../utils/measureShares";
import {
  PENSIONER_AGE_FIRST,
  PENSIONER_AGE_LAST,
  pensionerAge,
  pensionerMeasures,
  pensionerShares,
  pensionerSharesBySingleAge,
  pensionerTrend,
} from "./pensioners/pensionersData";
import { isCatalogueRowDisplayable, useMeasureCatalogue } from "../utils/measureCatalogue";
import {
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

/**
 * The average change per pensioner in every year shown, each policy's own
 * part stacked and the net change as a line, the selected year shaded.
 */
function TrendCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const data = pensionerTrend(rows, policies, selectedPolicies, DISPLAY_YEARS);
  const { domain, ticks } = divergingAxis(stackEnds(data, policies));
  const members = useMemo(
    () =>
      legendMembership(catalogue, selectedPolicies, (id) => {
        const name = policies.find((policy) => policy.id === id)?.name;
        return data.some((point) => Math.abs(point[name] ?? 0) > 0);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, policies, selectedPolicies],
  );
  const activeNames = drawnNames(members);
  const netLabel = activeNames.length > 1 ? "Net change" : undefined;
  // The section's key lists the measures (MeasureKey); alone, the card's own
  const key = useMeasureKey(members, netLabel);
  const first = fiscalYearTick(DISPLAY_YEARS[0]);
  const last = fiscalYearTick(DISPLAY_YEARS[DISPLAY_YEARS.length - 1]);
  const title = `Change per pensioner by year, ${first} to ${last}`;
  const description = "Average change per pensioner, £ a year; bars add each policy's own effect, the selected year shaded.";
  const names = selectedNames(policies, selectedPolicies);
  const unpublished = data.filter((point) => !point.published);
  const thin = data.filter((point) => point.published && point.suppressed);
  const download = {
    chartRef,
    name: "pensioners-change-by-year",
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: [
        ...exportLegendItems(members, catalogue),
        ...(activeNames.length > 1 ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }] : []),
      ],
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per pensioner by year, ${first} to ${last}`,
        units: `${CSV_UNITS}; pensioners are aged 66 and over in 2026-27 and 67 and over from 2027-28`,
        columns: [
          { key: "yearLabel", label: "Year" },
          ...names.map((name) => ({ key: name, label: name, decimals: 2 })),
          { key: "netChange", label: "Net change", decimals: 2 },
        ],
        rows: data
          .filter((point) => point.published && !point.suppressed)
          .map((point) => ({ ...point, yearLabel: fiscalYearTick(point.year) })),
        notes: [
          ...unpublished.map((point) => `${fiscalYearTick(point.year)}: not yet published`),
          ...thin.map((point) => `${fiscalYearTick(point.year)}: too few survey records`),
        ],
      }),
    published: data.some((point) => point.published),
  };
  const yWidth = axisWidth(ticks, signedPounds);

  return (
    <div className="pensioners-trend">
      <CardHeader icon="trend" title={title} description={description} download={download} />
      <div ref={chartRef} className="chart-plot young-people-plot">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={plotMargin(narrow, { right: 8 })} stackOffset="sign">
            <CartesianGrid {...GRID_PROPS} />
            <ReferenceArea x1={Number(selectedYear)} x2={Number(selectedYear)} fill={HIGHLIGHT_FILL} ifOverflow="visible" />
            <XAxis
              dataKey="year"
              tickFormatter={narrow ? shortFiscalYearTick : fiscalYearTick}
              axisLine={AXIS_LINE}
              tickLine={false}
              interval={0}
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
              cursor={HOVER_CURSOR}
              content={
                <ChartTooltip
                  format={pounds}
                  labelFormat={(year) => `Pensioners, ${fiscalYearTick(year)}`}
                  netKey="netChange"
                  netLabel="Net change"
                />
              }
            />
            {policyBars(catalogue, key.highlight)}
            <Line
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
      </div>
      <div className="chart-legend">
        {!key.shared && (
          <MeasureKey members={members} netLabel={netLabel} highlight={key.highlight} onHighlight={key.setHighlight} />
        )}
      </div>
      <Logo />
      <div className="chart-footer">
        {unpublished.length > 0 && (
          <Note>Not yet published: {unpublished.map((point) => fiscalYearTick(point.year)).join(", ")}.</Note>
        )}
        <ChartMoreInfo members={members} year={Number(selectedYear)} period={`in every year from ${first} to ${last}`} />
      </div>
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

/**
 * The average change per person by single year of age, 55 to 90 and over,
 * in the selected year, each policy's part stacked and the net change as a
 * dot, the pensioners' ages shaded. One axis for every year, so Play
 * shows the change between years.
 */
function AgeCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  const from = pensionerAge(year);
  const data = singleAgeBars(rows, policies, selectedPolicies, year, PENSIONER_AGE_FIRST, PENSIONER_AGE_LAST);
  const { domain, ticks } = useMemo(() => {
    const ends = [];
    for (const each of DISPLAY_YEARS) {
      const bars = singleAgeBars(rows, policies, selectedPolicies, each, PENSIONER_AGE_FIRST, PENSIONER_AGE_LAST);
      ends.push(...stackEnds(bars, policies));
    }
    return divergingAxis(ends);
  }, [rows, policies, selectedPolicies]);
  const members = useMemo(
    () =>
      legendMembership(catalogue, selectedPolicies, (id) =>
        data.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, policies, selectedPolicies, year],
  );
  const activeNames = drawnNames(members);
  const netLabel = activeNames.length > 1 ? "Net change" : undefined;
  // The section's key lists the measures (MeasureKey); alone, the card's own
  const key = useMeasureKey(members, netLabel);
  const missing = data.filter((point) => point.netChange === null);
  const title = `Change by age, ${yearLabel}`;
  const description = `Average change per person, £ a year, by single year of age (${PENSIONER_AGE_FIRST} to 90 and over); pensioners' ages shaded.`;
  const names = selectedNames(policies, selectedPolicies);
  const download = {
    chartRef,
    name: `pensioners-change-by-age-${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: [
        ...exportLegendItems(members, catalogue),
        ...(activeNames.length > 1 ? [{ color: CHART_COLOURS.net, label: "Net change", type: "line" }] : []),
      ],
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per person by single year of age, ${yearLabel}`,
        units: `${CSV_UNITS}; the sum of each selected policy's own effect`,
        columns: [
          { key: "label", label: "Age" },
          ...names.map((name) => ({ key: name, label: name, decimals: 2 })),
          { key: "netChange", label: "Net change", decimals: 2 },
        ],
        rows: published ? data.filter((point) => point.netChange !== null) : [],
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
            <ComposedChart data={data} margin={plotMargin(narrow)} barCategoryGap="14%" stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea
                x1={singleAgeKey(from)}
                x2={singleAgeKey(PENSIONER_AGE_LAST)}
                fill={HIGHLIGHT_FILL}
                ifOverflow="visible"
              />
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
                tickFormatter={signedPounds}
                tick={TICK_STYLE}
                width={axisWidth(ticks, signedPounds)}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={HOVER_CURSOR}
                content={
                  <ChartTooltip
                    format={pounds}
                    labelFormat={(label) => `Age ${label}, ${yearLabel}`}
                    netKey="netChange"
                    netLabel="Net change"
                  />
                }
              />
              {policyBars(catalogue, key.highlight)}
              <Scatter
                dataKey="netChange"
                shape={netDot}
                legendType="none"
                tooltipType="none"
                {...chartMotion()}
                hide={activeNames.length <= 1}
              />
              <Customized component={<ChartUnitLabel text={AGE_UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {published && !key.shared && (
          <MeasureKey members={members} netLabel={netLabel} highlight={key.highlight} onHighlight={key.setHighlight} />
        )}
      </div>
      <Logo />
      {published && (
        <div className="chart-footer">
          {missing.length > 0 && (
            <Note>Not shown, as too few survey records: ages {missing.map((p) => p.label).join(", ")}.</Note>
          )}
          <ChartMoreInfo members={members} year={year} />
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
      {/* Notes and More info in the card's footer row, level across a pair */}
      {published && (notes.length > 0 || noEffectItems.length > 0) && (
        <div className="chart-footer">
          {notes.length > 0 && <Note>{notes.join(". ")}.</Note>}
          {noEffectItems.length > 0 && <NoEffectList items={noEffectItems} title={`No effect in ${yearLabel}`} />}
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

/** A group's name down the side, wrapped to two lines where long. */
function GroupTick({ x, y, payload, narrow }) {
  const words = narrow && payload.value === "Under State Pension age" ? ["Under State", "Pension age"] : [payload.value];
  const bold = payload.value === "Pensioners";
  return (
    <text
      x={x - 6}
      y={y}
      textAnchor="end"
      dominantBaseline="middle"
      fontSize={13}
      fill={bold ? CHART_COLOURS.highlight : TICK_STYLE.fill}
      fontWeight={bold ? 600 : 400}
    >
      {words.map((word, index) => (
        <tspan key={word} x={x - 6} dy={index === 0 ? (words.length - 1) * -7 : 14}>
          {word}
        </tspan>
      ))}
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
        {row.measure ? `${row.measure}: ${row.groupLabel}` : ageLabel(label)}, {yearLabel}
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
function SharesCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  // By group (pensioners, under State Pension age, all ages) or by single
  // year of age from State Pension age, as Young people's card
  const [view, setView] = useState("band");
  // With no run for the whole selection: one row group per measure, its own
  // shares for pensioners, people under State Pension age and all ages
  const perMeasure = sharesByMeasureAllGroups(pensionerShares, rows, policies, selectedPolicies, year, catalogue.combinedId);
  const labels = perMeasure
    ? Object.fromEntries(perMeasure.rows.map((r) => [`${r.id}|${r.groupKey}`, { name: r.name, group: r.groupLabel, first: r.first }]))
    : {};
  const single = !perMeasure && view === "single";
  const from = pensionerAge(year);
  const shares = perMeasure ? null : (single ? pensionerSharesBySingleAge : pensionerShares)(rows, policies, selectedPolicies, year, catalogue.combinedId);
  const data = perMeasure
    ? perMeasure.rows.map((row) =>
        visibleSegments(
          {
            group: `${row.id}|${row.groupKey}`,
            key: `${row.id}|${row.groupKey}`,
            measure: row.name,
            groupLabel: row.groupLabel,
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
    ? "Share of people better or worse off (a change over 0.01%): pensioners, people under State Pension age and all ages, each selected measure on its own."
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
          ? `People better off, unchanged and worse off, pensioners and others, each measure on its own, ${yearLabel}`
          : single
          ? `People better off, unchanged and worse off by single year of age, pensioners, ${yearLabel}`
          : `People better off, unchanged and worse off, pensioners and others, ${yearLabel}`,
        units: `% of people in the group; a change of more than 0.01% of household net income; pensioners are aged ${pensionerAge(year)} and over`,
        columns: [
          ...(perMeasure ? [{ key: "measure", label: "Measure" }] : []),
          { key: perMeasure ? "groupLabel" : "group", label: single ? "Age" : "Group" },
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
        {!perMeasure && (
          <ControlBar name={title} options={[{ label: "Show", value: view, onChange: setView, options: AGE_VIEWS }]} />
        )}
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : data.length && single ? (
          // One 100% bar per age from State Pension age, then the
          // pensioners' total; the ▲/▼ split at the right as in the group view
          <ResponsiveContainer width="100%" height={singleSharesHeight(data.length)}>
            <BarChart data={data} layout="vertical" margin={plotMargin(narrow)} barCategoryGap={3} barSize={14}>
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
                <Bar key={outcome.key} dataKey={outcome.key} name={outcome.label} fill={outcome.color} stackId="share" {...chartMotion()} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : data.length ? (
          <ResponsiveContainer width="100%" height={perMeasure ? Math.max(height, data.length * 30 + perMeasure.rows.filter((r) => r.first).length * 18 + 60) : height}>
            <BarChart data={data} layout="vertical" margin={plotMargin(narrow)} barCategoryGap={perMeasure ? "18%" : "28%"}>
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={X_AXIS_HEIGHT}
                label={{ value: "Share of people in the group", position: "insideBottom", offset: 0, style: AXIS_TITLE_STYLE }}
              />
              <YAxis
                type="category"
                dataKey="group"
                tick={perMeasure ? <MeasureGroupTick labels={labels} narrow={narrow} /> : <GroupTick narrow={narrow} />}
                width={perMeasure ? (narrow ? 132 : 200) : narrow ? 92 : 168}
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
                <Bar key={outcome.key} dataKey={outcome.key} name={outcome.label} fill={outcome.color} stackId="share" {...chartMotion()} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>No shares are published for this selection in {yearLabel}.</p>
          </div>
        )}
      </div>
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
        {/* The same foot as the card beside it, so the pair ends level */}
        <ChartMoreInfo year={Number(selectedYear)}>
          <p>Each person counts their household&apos;s change in net income.</p>
          {perMeasure && (
            <p>
              Each row is one measure simulated on its own. The shares can&apos;t be added up across measures, and no
              published run covers this selection together.
              {perMeasure.missing.length > 0 && ` Not shown, too few survey records: ${perMeasure.missing.join(", ")}.`}
            </p>
          )}
        </ChartMoreInfo>
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
      <p className="view-status" role="status">
        {status === "loading" ? "Loading results by age…" : "Results by age are not available."}
      </p>
    );
  }
  return (
    <>
      <SectionHeading
        id={PENSIONERS_ANCHOR}
        title="Change for pensioners"
        subtitle="Pensioners here are people at or over State Pension age: 66 and over in 2026-27, and 67 and over from 2027-28, as State Pension age rises to 67. Each person counts their household's change in net income."
      />
      {/* Both cards colour by measure: one key above the pair, not a long
          legend in each */}
      <MeasureKeyProvider>
        <section className="report-section young-people-section" aria-label="Change for pensioners">
          <SectionMeasureKey />
          <div className="charts-grid">
            <TrendCard {...props} height={narrow ? 340 : 400} />
            <AgeCard {...props} height={narrow ? 340 : 400} />
          </div>
        </section>
      </MeasureKeyProvider>
      <SectionHeading
        title="Who gains and from what"
        subtitle="Which policies drive the change for pensioners, and how many are better or worse off."
      />
      <section className="report-section young-people-section" aria-label="Who gains and from what">
        <div className="charts-grid">
          <MeasuresCard {...props} height={narrow ? 460 : 400} />
          <SharesCard {...props} height={narrow ? 260 : 400} />
        </div>
      </section>
    </>
  );
}

export default PensionersSection;
