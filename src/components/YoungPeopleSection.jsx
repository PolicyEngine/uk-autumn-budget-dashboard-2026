import { useEffect, useMemo, useRef, useState } from "react";
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
  chartMargin,
  legendWrapperStyle,
  axisWidth,
  fiscalYearTick,
} from "../utils/chartTheme";
import {
  AGE_BANDS,
  YOUNG_BAND,
  formatPeople,
  isPublished,
  meanChangeByBand,
  youngAndAll,
  youngPopulation,
} from "../utils/ageImpact";
import "./YoungPeopleSection.css";

/** The section's anchor: link to it as #young-people. */
export const YOUNG_PEOPLE_ANCHOR = "young-people";

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/age_impact.csv`;

// Highlight for the 16 to 24 band
const YOUNG_FILL = "rgba(49, 151, 149, 0.10)";
// Better off, unchanged, worse off: the page's teal and amber, grey between
const OUTCOMES = [
  { key: "pct_better_off", label: "Better off", color: "#0D9488" },
  { key: "pct_unchanged", label: "Unchanged", color: "#D1D5DB" },
  { key: "pct_worse_off", label: "Worse off", color: "#D97706" },
];

const MEAN_DESCRIPTION =
  "Average change in household net income per person, by age, in pounds a year. Each person counts their household's change, so people in households that gain more pull their age group's average up. Bars add up each selected policy's own effect.";
const SHARES_DESCRIPTION =
  "The share of people whose household net income rises or falls by more than 0.01%, for young people aged 16 to 24 and for people of all ages.";

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

function MeanChangeCard({ rows, policies, selectedPolicies, selectedYear, narrow }) {
  const chartRef = useRef(null);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const data = meanChangeByBand(rows, policies, selectedPolicies, selectedYear);

  // One axis for every year, so moving the year pill never rescales it
  const { domain, ticks } = useMemo(() => {
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

  const activeNames = ALL_POLICY_NAMES.filter((name) =>
    data.some((point) => Math.abs(point[name] ?? 0) > 0.01),
  );
  const youngLabel = AGE_BANDS.find((band) => band.key === YOUNG_BAND).label;
  const suppressed = data.filter((point) => point.suppressed);

  const title = `Average change by age, ${yearLabel}`;
  const exportName = `young-people-change-by-age-${selectedYear}`;
  const exportOptions = {
    title,
    description: MEAN_DESCRIPTION,
    logo: CHART_LOGO,
    legendItems: [
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
  const csvText = () =>
    buildChartCsv({
      title: `Average change in household net income per person by age, ${yearLabel}`,
      units:
        "£ per person per year; each person counts their household's change in net income (not equivalised)",
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

  return (
    <div className="young-people-mean">
      <div className="chart-header">
        <div>
          <h3>
            <NoBreakYear text={title} />
          </h3>
          <p className="chart-description">{MEAN_DESCRIPTION}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div ref={chartRef}>
        {published ? (
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
                  animationDuration={500}
                  animationBegin={0}
                  hide={!activeNames.includes(name)}
                />
              ))}
              <Line
                type="linear"
                dataKey="netChange"
                name="netChange"
                stroke="#000000"
                strokeWidth={2}
                dot={{ fill: "#000000", stroke: "#ffffff", strokeWidth: 1.5, r: 3.5 }}
                animationDuration={500}
                hide={activeNames.length <= 1}
              />
              <Customized component={<ChartUnitLabel text="Average change per person (£ a year)" />} />
              <Customized component={PolicyEngineLogo} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        )}
      </div>
      {published && suppressed.length > 0 && (
        <Note>
          Not shown, as too few survey records: {suppressed.map((p) => p.label).join(", ")}.
        </Note>
      )}
    </div>
  );
}

function SharesCard({ rows, policies, selectedPolicies, selectedYear, narrow }) {
  const chartRef = useRef(null);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const pair = youngAndAll(rows, policies, selectedPolicies, selectedYear);
  const data = pair
    ? [
        { group: "Aged 16 to 24", ...pick(pair.young) },
        { group: "All ages", ...pick(pair.all) },
      ]
    : [];

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
      title: `People better off, unchanged and worse off, ${yearLabel}`,
      units: "% of people in the group; a change of more than 0.01% of household net income",
      columns: [
        { key: "group", label: "Group" },
        ...OUTCOMES.map((outcome) => ({
          key: outcome.key,
          label: `${outcome.label} (%)`,
          decimals: 2,
        })),
      ],
      rows: data,
    });
  // Until the year is published, only its CSV (the menu says why otherwise)
  const download = {
    chartRef,
    name: exportName,
    exportOptions,
    csv: csvText,
    published: Boolean(pair),
  };
  const height = narrow ? 300 : 260;

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
            pair || !published ? undefined : "Choose one policy or all policies"
          }
        />
      </div>
      <div ref={chartRef}>
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : pair ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={chartMargin(narrow, { top: 8 })}
              barCategoryGap="28%"
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={TICK_STYLE}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="group"
                tick={TICK_STYLE}
                width={narrow ? 92 : 104}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                {...TOOLTIP_PROPS}
                cursor={{ fill: "rgba(49, 151, 149, 0.08)" }}
                content={<ChartTooltip format={percent} grouped={false} />}
              />
              <Legend wrapperStyle={legendWrapperStyle(narrow)} content={<OutcomeLegend />} />
              {OUTCOMES.map((outcome) => (
                <Bar
                  key={outcome.key}
                  dataKey={outcome.key}
                  name={outcome.label}
                  fill={outcome.color}
                  stackId="share"
                  animationDuration={500}
                  animationBegin={0}
                >
                  {/* The share on the segment, where it fits */}
                  <LabelList
                    dataKey={outcome.key}
                    position="center"
                    formatter={(value) => (value >= 8 ? `${Math.round(value)}%` : "")}
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
          <div className="chart-empty" style={{ minHeight: height }} role="status">
            <p>
              These shares come from one simulation of the selected policies
              together, so they are shown for a single policy or for all
              policies.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const pick = (row) =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome.key, row[outcome.key]]));

function Headline({ rows, policies, selectedPolicies, selectedYear }) {
  const population = youngPopulation(rows, selectedYear);
  const pair = youngAndAll(rows, policies, selectedPolicies, selectedYear);
  const direct = pair ? pair.young.people_directly_affected : null;
  return (
    <div className="young-people-headline">
      <div className="young-people-stat">
        <p className="young-people-stat-value">{formatPeople(population)}</p>
        <p className="young-people-stat-label">young people aged 16 to 24 in the UK</p>
      </div>
      <div className="young-people-stat">
        <p className="young-people-stat-value">
          {pair ? formatPeople(direct) : "–"}
          {pair && population ? (
            <span className="young-people-stat-share">
              {" "}
              ({percent((direct / pair.young.people) * 100)} of them)
            </span>
          ) : null}
        </p>
        <p className="young-people-stat-label">
          {pair
            ? "directly affected: their own income tax, National Insurance, student loan repayments or earnings change"
            : "directly affected: shown for a single policy or for all policies"}
        </p>
      </div>
    </div>
  );
}

/**
 * "Young people (under 25)": how the selected policies change household
 * incomes by age, with young people aged 16 to 24 highlighted. It loads
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
        subtitle="How the selected policies change the household incomes of young people aged 16 to 24, compared with other ages, in the selected year."
      />
      <section className="report-section young-people-section" aria-label="Young people (under 25)">
        {status === "ready" ? (
          <>
            <Headline {...props} />
            <div className="charts-grid">
              <MeanChangeCard {...props} />
              <SharesCard {...props} />
            </div>
          </>
        ) : (
          <div className="young-people-headline young-people-status" role="status">
            <p>
              {status === "loading"
                ? "Loading results by age…"
                : "Results by age are not available."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

export default YoungPeopleSection;
