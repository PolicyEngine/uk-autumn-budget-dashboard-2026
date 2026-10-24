import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAY_YEARS } from "../utils/displayYears";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Customized,
  LabelList,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Scatter,
} from "recharts";
import { PolicyEngineLogo, CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { parseTable } from "../utils/publication/csv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartTooltip, { TOOLTIP_PROPS } from "./ChartTooltip";
import GroupedLegend from "./GroupedLegend";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import UnpublishedPlot from "./UnpublishedPlot";
import NoBreakYear from "./NoBreakYear";
import SectionHeading from "./SectionHeading";
import Note from "./Note";
import PillSelect from "./PillSelect";
import MeasuresCard from "./youngPeople/MeasuresCard";
import TrendCard from "./youngPeople/TrendCard";
import {
  ALL_POLICY_NAMES,
  POLICY_COLORS,
  REVENUE_RAISING_NAMES,
} from "../utils/policyConfig";
import {
  useNarrowViewport,
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  chartMargin,
  legendWrapperStyle,
  axisWidth,
  fiscalYearTick,
} from "../utils/chartTheme";
import {
  AGE_BANDS,
  SINGLE_AGE_TOP,
  YOUNG_BAND,
  isPublished,
  meanChangeByBand,
  meanChangeBySingleAge,
  sharesByGroup,
} from "../utils/ageImpact";
import { niceRange } from "./youngPeople/youngPeopleData";
import "./YoungPeopleSection.css";
import { chartMotion, netDot } from "../utils/chartMotion";

/** The section's anchor: link to it as #young-people. */
export const YOUNG_PEOPLE_ANCHOR = "young-people";

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/age_impact.csv`;

// Highlight for the 16 to 24 band, and its legend swatch (the same tint
// on white)
const YOUNG_FILL = "rgba(49, 151, 149, 0.10)";
const YOUNG_SWATCH = "#EAF5F4";
// Better off, unchanged, worse off: the page's teal and amber, grey between
const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: "#0D9488" },
  { key: "pct_unchanged", label: "Unchanged", color: "#D1D5DB" },
  { key: "pct_worse_off", label: "Worse off", color: "#D97706" },
];

const MEAN_DESCRIPTION =
  "Average change in household net income per person, by age group, in pounds a year. Each person counts their household's change; bars add up each selected policy's own effect.";
const SINGLE_AGE_DESCRIPTION =
  "Average change in household net income per person, by single year of age, in pounds a year. Each person counts their household's change; the line adds up the selected policies' own effects.";
const SHARES_DESCRIPTION =
  "The share of people whose household net income rises or falls by more than 0.01%, by age group and for all ages.";

/** The two views of "Average change by age". */
const AGE_VIEWS = [
  { value: "band", label: "By age group" },
  { value: "single", label: "By single year of age" },
];
const SINGLE_AGE_TICKS = Array.from({ length: SINGLE_AGE_TOP / 10 + 1 }, (_, i) => i * 10);
const ageTick = (age) => (age >= SINGLE_AGE_TOP ? `${SINGLE_AGE_TOP}+` : String(age));
const UNIT = "Average change per person (£ a year)";

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const signedPounds = (value) =>
  value < 0 ? `-£${Math.abs(Math.round(value)).toLocaleString("en-GB")}` : pounds(value);
const percent = (value) => `${value.toFixed(1)}%`;

/** Ticks for a symmetric domain: steps of 50, 100, 250, 500 or 1,000. */
function niceDomain(maxAbs) {
  const steps = [25, 50, 100, 250, 500, 1000, 2500];
  const step = steps.find((candidate) => maxAbs / candidate <= 4) ?? 5000;
  const top = Math.max(step, Math.ceil(maxAbs / step) * step);
  const ticks = [];
  for (let tick = -top; tick <= top + 1e-9; tick += step) ticks.push(tick);
  return { domain: [-top, top], ticks };
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

/** The outcome legend: one row of swatches, in the grouped legend's style. */
function OutcomeLegend() {
  return (
    <div className="grouped-legend is-columns young-people-outcome-legend">
      <ul className="grouped-legend-items">
        {OUTCOMES.map((outcome) => (
          <li key={outcome.key}>
            <span
              className="grouped-legend-swatch"
              style={{ background: outcome.color }}
              aria-hidden="true"
            />
            <span className="grouped-legend-label">{outcome.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      fill={young ? "#285E61" : TICK_STYLE.fill}
      fontWeight={young ? 600 : 400}
    >
      {narrow ? band?.short : payload.value}
    </text>
  );
}

/** A stable symmetric axis for the band view, over every year. */
function useBandDomain(rows, policies, selectedPolicies) {
  return useMemo(() => {
    const years = [...new Set((rows ?? []).map((row) => row.year))];
    let maxAbs = 0;
    for (const year of years) {
      for (const point of meanChangeByBand(rows, policies, selectedPolicies, year)) {
        let up = 0;
        let down = 0;
        for (const policy of policies) {
          const value = point[policy.name] ?? 0;
          if (value > 0) up += value;
          else down += value;
        }
        maxAbs = Math.max(maxAbs, up, -down);
      }
    }
    return niceDomain(maxAbs);
  }, [rows, policies, selectedPolicies]);
}

/** A stable axis for the single-year view, over every year. */
function useSingleAgeDomain(rows, policies, selectedPolicies) {
  return useMemo(() => {
    const years = [...new Set((rows ?? []).map((row) => row.year))];
    const values = years
      .flatMap((year) => meanChangeBySingleAge(rows, policies, selectedPolicies, year))
      .map((point) => point.netChange)
      .filter((value) => value !== null);
    return niceRange(Math.min(0, ...values), Math.max(0, ...values));
  }, [rows, policies, selectedPolicies]);
}

function MeanChangeCard({ rows, policies, selectedPolicies, selectedYear, narrow }) {
  const chartRef = useRef(null);
  const [view, setView] = useState("band");
  const single = view === "single";
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const data = meanChangeByBand(rows, policies, selectedPolicies, selectedYear);
  const singleData = meanChangeBySingleAge(rows, policies, selectedPolicies, selectedYear);
  const bandAxis = useBandDomain(rows, policies, selectedPolicies);
  const singleAxis = useSingleAgeDomain(rows, policies, selectedPolicies);
  const { domain, ticks } = single ? singleAxis : bandAxis;

  // Measures with an effect in any shown year, so the legend (and the
  // plot's height) holds still when the year changes or Play runs
  const activeNames = useMemo(
    () =>
      ALL_POLICY_NAMES.filter((name) =>
        DISPLAY_YEARS.some((year) =>
          meanChangeByBand(rows, policies, selectedPolicies, year).some(
            (point) => Math.abs(point[name] ?? 0) > 0.01,
          ),
        ),
      ),
    [rows, policies, selectedPolicies],
  );
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
    legendItems: single
      ? [{ color: "#319795", label: "Net change", type: "line" }]
      : [
          ...activeNames.map((name) => ({
            color: POLICY_COLORS[name],
            label: name,
            type: "rect",
            group: REVENUE_RAISING_NAMES.has(name) ? "raise" : "cost",
          })),
          ...(activeNames.length > 1
            ? [{ color: "#000000", label: "Net change", type: "line" }]
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
            { key: "netChange", label: "Net change", decimals: 2 },
          ],
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
  const height = narrow ? 560 : 440;
  const notShown = single
    ? missingAges.length > 0 && `ages ${missingAges.map((p) => p.label).join(", ")}`
    : suppressed.length > 0 && suppressed.map((p) => p.label).join(", ");

  return (
    <div className="young-people-mean">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={title} />
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
      <div ref={chartRef} className="young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : single ? (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={singleData} margin={chartMargin(narrow)}>
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1={15.5} x2={24.5} fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="age"
                type="number"
                domain={[0, SINGLE_AGE_TOP]}
                ticks={SINGLE_AGE_TICKS}
                tickFormatter={ageTick}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
                height={44}
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
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ stroke: "#D1D5DB" }}
                content={
                  <ChartTooltip
                    format={pounds}
                    grouped={false}
                    showPlus
                    labelFormat={(age) => `Aged ${ageTick(age)}`}
                  />
                }
              />
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                content={
                  <GroupedLegend
                    items={[
                      { key: "net", label: "Net change", color: "#319795", type: "line" },
                      { key: "young", label: "16 to 24 shaded", color: YOUNG_SWATCH },
                    ]}
                  />
                }
              />
              <Line
                type="linear"
                dataKey="netChange"
                name="Net change"
                stroke="#319795"
                strokeWidth={2.25}
                dot={false}
                activeDot={{ r: 4, fill: "#319795", stroke: "#ffffff", strokeWidth: 1.5 }}
                connectNulls={false}
                animationDuration={500}
              />
              <Customized component={<ChartUnitLabel text={UNIT} />} />
              <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={chartMargin(narrow)} stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <ReferenceArea x1={youngLabel} x2={youngLabel} fill={YOUNG_FILL} ifOverflow="visible" />
              <XAxis
                dataKey="label"
                tick={<AgeTick narrow={narrow} />}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                height={28}
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
              <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={
                  <ChartTooltip
                    format={pounds}
                    labelFormat={(label) => `Aged ${label.toLowerCase()}`}
                    netKey="netChange"
                    netLabel="Net change"
                  />
                }
              />
              <Legend
                wrapperStyle={legendWrapperStyle(narrow)}
                content={
                  <GroupedLegend
                    names={activeNames}
                    netLabel={activeNames.length > 1 ? "Net change" : undefined}
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
                type="linear"
                dataKey="netChange"
                name="netChange"
                stroke="#000000"
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
              <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {published && notShown && <Note>Not shown, as too few survey records: {notShown}.</Note>}
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
      fill={young ? "#285E61" : TICK_STYLE.fill}
      fontWeight={young || !band ? 600 : 400}
    >
      {label}
    </text>
  );
}

function SharesCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const chartRef = useRef(null);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const shares = sharesByGroup(rows, policies, selectedPolicies, selectedYear);
  const data = shares
    ? shares.groups
        .filter((group) => !group.suppressed)
        .map((group) => ({ group: group.label, key: group.key, ...pick(group.row) }))
    : [];
  const thin = shares ? shares.groups.filter((group) => group.suppressed) : [];

  const title = `Better and worse off, ${yearLabel}`;
  const exportName = `young-people-better-worse-off-${selectedYear}`;
  const exportOptions = {
    title,
    description: SHARES_DESCRIPTION,
    logo: CHART_LOGO,
    legendItems: OUTCOMES.map((outcome) => ({
      color: outcome.color,
      label: outcome.label,
      type: "rect",
    })),
  };
  const csvText = () =>
    buildChartCsv({
      title: `People better off, unchanged and worse off by age group, ${yearLabel}`,
      units: "% of people in the group; a change of more than 0.01% of household net income",
      columns: [
        { key: "group", label: "Age group" },
        ...OUTCOMES.map((outcome) => ({
          key: outcome.key,
          label: `${outcome.label} (%)`,
          decimals: 2,
        })),
      ],
      rows: data,
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
            <NoBreakYear text={title} />
          </h3>
          <p className="chart-description">{SHARES_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu
          download={download}
          chartTitle={title}
          disabledReason={
            shares || !published ? undefined : "Choose one policy or all policies"
          }
        />
      </div>
      <div ref={chartRef}>
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : data.length ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={chartMargin(narrow, { top: 8 })}
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
                height={44}
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
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={
                  <ChartTooltip
                    format={percent}
                    grouped={false}
                    labelFormat={(label) => (label === "All ages" ? label : `Aged ${label.toLowerCase()}`)}
                  />
                }
              />
              <Legend wrapperStyle={legendWrapperStyle(narrow)} content={<OutcomeLegend />} />
              {OUTCOMES.map((outcome) => (
                <Bar
                  key={outcome.key}
                  dataKey={outcome.key}
                  name={outcome.label}
                  fill={outcome.color}
                  stackId="share"
                  {...chartMotion()}
                >
                  {/* The share on the segment, where it fits */}
                  <LabelList
                    dataKey={outcome.key}
                    position="center"
                    formatter={(value) => (value >= (narrow ? 14 : 8) ? `${Math.round(value)}%` : "")}
                    fill={outcome.key === "pct_unchanged" ? "#374151" : "#FFFFFF"}
                    fontSize={12}
                    fontWeight={600}
                  />
                </Bar>
              ))}
              <Customized component={PolicyEngineLogo} />
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
      {published && thin.length > 0 && (
        <Note>Not shown, as too few survey records: {thin.map((group) => group.label).join(", ")}.</Note>
      )}
    </div>
  );
}

const pick = (row) =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome.key, row[outcome.key]]));

/**
 * "Young people (under 25)": how the selected policies change household
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
      <SectionHeading
        id={YOUNG_PEOPLE_ANCHOR}
        className="young-people-heading"
        title="Young people (under 25)"
        subtitle="How the selected policies change household incomes by age group, with young people aged 16 to 24 highlighted."
      />
      <section className="report-section young-people-section" aria-label="Young people (under 25)">
        {status === "ready" ? (
          <>
            <div className="charts-grid">
              <MeanChangeCard {...props} />
              <MeasuresCard {...props} height={narrow ? 600 : 440} />
            </div>
            <div className="charts-grid">
              <SharesCard {...props} height={narrow ? 400 : 380} />
              <TrendCard {...props} height={narrow ? 400 : 380} />
            </div>
          </>
        ) : (
          <p className="view-status" role="status">
            {status === "loading" ? "Loading results by age…" : "Results by age are not available."}
          </p>
        )}
      </section>
    </>
  );
}

export default YoungPeopleSection;
