import { useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Customized, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import ControlBar from "../ControlBar";
import { measureOpacity, useMeasureKey, netOpacity } from "../MeasureKey";
import TitleIcon from "../TitleIcon";
import ChartMoreInfo from "../ChartMoreInfo";
import { BY_YEAR_METHOD } from "../methodology/anchors";
import Note from "../Note";
import {
  GRID_PROPS,
  TICK_STYLE,
  AXIS_LINE,
  axisWidth,
  fiscalYearTick,
  shortFiscalYearTick,
  CHART_COLOURS,
  REFERENCE_DASH,
  PHONE_QUERY,
  useViewportMatch,
} from "../../utils/chartTheme";
import { useDisplayYears } from "../../utils/displayYears";
import { ALL_BAND } from "../../utils/ageImpact";
import { legendMembership } from "../../utils/legendMembership";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { shortNameOf } from "../../utils/policyDetails";
import { X_AXIS_HEIGHT, plotMargin } from "../youngPeople/chartRows";
import { cumulate, groupMeasureSeries, niceRange, signedPounds, stepAnnotations } from "../youngPeople/youngPeopleData";
import { EndLabels, StepLabels, TrendTooltip, YearShading, about, signed, stackColumns, stepSentence } from "../youngPeople/TrendCard";
import SeriesToggle from "../SeriesToggle";
import { pensionerMeasureSeries } from "./pensionersData";

const FOCUS = "pensioners";
const FOCUS_LABEL = "Pensioners";
const FOCUS_COLOUR = CHART_COLOURS.gain;

const VIEW_OPTIONS = [
  { value: "lines", label: "Lines", summary: "Lines" },
  { value: "measures", label: "Policies, pensioners", summary: "By policy" },
];
const YEARS_OPTIONS = [
  { value: "each", label: "Each year", summary: "Each year" },
  { value: "total", label: "Running total", summary: "Running total" },
];

const LINES = [
  { key: ALL_BAND, label: "All ages", short: "All", colour: CHART_COLOURS.reference, dash: REFERENCE_DASH, width: 2, strong: true },
  { key: FOCUS, label: FOCUS_LABEL, short: "Pens.", colour: FOCUS_COLOUR, width: 3, strong: true },
];

/**
 * How the change per pensioner moves year by year, against all ages: the
 * Young people "Change by year" card for pensioners (people at or over
 * State Pension age). A headline, the measure behind each big step named
 * on the line, a tooltip with the top two measures, and a breakdown by
 * measure with the net line, highlighted from the section's measure key.
 */
export default function PensionerTrendCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const shownYears = useDisplayYears();
  const chartRef = useRef(null);
  const catalogue = useMeasureCatalogue();
  // On a phone the step labels do not fit the plot: the sentence names them
  const phone = useViewportMatch(PHONE_QUERY);
  const [view, setView] = useState("lines");
  const [years, setYears] = useState("each");
  const [hovered, setHovered] = useState(null);
  // Which lines are drawn (SeriesToggle), both at first
  const [shown, setShown] = useState([FOCUS, ALL_BAND]);
  const cumulative = years === "total";
  const byMeasure = view === "measures";

  const focusSeries = useMemo(
    () => pensionerMeasureSeries(rows, policies, selectedPolicies, shownYears),
    [rows, policies, selectedPolicies, shownYears],
  );
  const allSeries = useMemo(
    () => groupMeasureSeries(rows, policies, selectedPolicies, shownYears, ALL_BAND),
    [rows, policies, selectedPolicies, shownYears],
  );
  const partKeys = [...new Set(focusSeries.flatMap((point) => point.parts.map((part) => part.key)))];
  const raw = focusSeries.map((point, i) => ({ ...point, [FOCUS]: point.net, [ALL_BAND]: allSeries[i]?.net ?? null }));
  const data = cumulative ? cumulate(raw, [...partKeys, "net", FOCUS, ALL_BAND]) : raw;

  const measure = (id) => catalogue.byId.get(id);
  const nameOf = (id) => (measure(id) ? shortNameOf(measure(id)) : id);
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
      legendMembership(catalogue, selectedPolicies, (id) =>
        focusSeries.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
      ),
    [catalogue, selectedPolicies, focusSeries],
  );
  const key = useMeasureKey(byMeasure ? members : [], byMeasure ? "Net change" : undefined);

  const values = byMeasure
    ? data.flatMap((point) => {
        if (point.net === null) return [];
        const keys = partKeys.filter((each) => point[each] !== null && point[each] !== undefined);
        return [
          keys.reduce((sum, each) => sum + Math.max(0, point[each]), 0),
          keys.reduce((sum, each) => sum + Math.min(0, point[each]), 0),
          point.net,
        ];
      })
    : data.flatMap((point) => shown.map((each) => point[each])).filter((v) => v !== null && v !== undefined);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values));

  const unpublished = focusSeries.filter((point) => point.net === null);
  const first = fiscalYearTick(shownYears[0]);
  const last = fiscalYearTick(shownYears[shownYears.length - 1]);
  const title = `Change per pensioner by year, ${first} to ${last}`;
  const description = cumulative ? `Running total per pensioner from ${first}, £.` : "Average change per pensioner, £ a year.";

  const selected = focusSeries.find((point) => point.year === Number(selectedYear));
  const headline = (() => {
    if (cumulative) {
      const shown = focusSeries.filter((point) => point.net !== null);
      if (!shown.length) return null;
      const total = shown.reduce((sum, point) => sum + point.net, 0);
      if (Math.round(Math.abs(total)) === 0) {
        return `Pensioners see almost no change in total from ${fiscalYearTick(shown[0].year)} to ${fiscalYearTick(shown[shown.length - 1].year)}.`;
      }
      return `Pensioners ${total >= 0 ? "gain" : "lose"} ${about(total)} each in total from ${fiscalYearTick(shown[0].year)} to ${fiscalYearTick(shown[shown.length - 1].year)}.`;
    }
    if (!selected || selected.net === null) return null;
    // About £0 is no gain or loss: said as almost no change
    let text =
      Math.round(Math.abs(selected.net)) === 0
        ? `Pensioners see almost no change in ${fiscalYearTick(selected.year)}`
        : `Pensioners ${selected.net >= 0 ? "gain" : "lose"} ${about(selected.net)} a year in ${fiscalYearTick(selected.year)}`;
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
  // On a phone, the steps the plot cannot label, unless the headline names them
  const stepsLine = phone && !cumulative ? stepSentence(notes, headline, (id) => inSentence(nameOf(id))) : null;

  const focusAt = (year) => {
    const point = data.find((p) => p.year === year);
    return (byMeasure ? point?.net : point?.[FOCUS]) ?? null;
  };
  const allAt = (year) => data.find((p) => p.year === year)?.[ALL_BAND] ?? null;

  const download = {
    chartRef,
    name: `pensioners-change-by-year${byMeasure ? "-by-measure" : ""}${cumulative ? "-running-total" : ""}`,
    exportOptions: {
      title,
      description: headline ?? description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: byMeasure ? [] : LINES.map((line) => ({ color: line.colour, label: line.label, type: "line", dash: line.dash })),
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per pensioner by year, ${first} to ${last}`,
        units: `${cumulative ? "£ per person, running total from the first year" : "£ per person per year"}; each policy's own effect; pensioners are aged 66 and over in 2026-27 and 67 and over from 2027-28`,
        columns: [
          { key: "yearLabel", label: "Year" },
          ...partKeys.map((each) => ({ key: each, label: catalogue.bySeriesKey.get(each)?.label ?? each, decimals: 2 })),
          { key: FOCUS, label: "Pensioners, net change", decimals: 2 },
          { key: ALL_BAND, label: "All ages, net change", decimals: 2 },
        ],
        rows: data.filter((point) => point.net !== null).map((point) => ({ ...point, yearLabel: fiscalYearTick(point.year) })),
        notes: unpublished.map((point) => `${fiscalYearTick(point.year)}: not published, or too few survey records`),
      }),
    published: focusSeries.some((point) => point.net !== null),
  };
  const margin = plotMargin(narrow, { right: byMeasure ? 16 : narrow ? 44 : 84 });

  return (
    <div className="pensioners-trend">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="trend" />
            <span className="title-text">{title}</span>
          </h3>
          <p className="chart-description">
            {headline ? <strong className="trend-headline">{headline}</strong> : null} {description}
            {stepsLine ? ` ${stepsLine}` : null}
          </p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-controls young-people-controls">
        <ControlBar
          name={title}
          options={[
            { label: "Breakdown", value: view, onChange: setView, options: VIEW_OPTIONS },
            { label: "Years", value: years, onChange: setYears, options: YEARS_OPTIONS },
          ]}
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={margin} stackOffset="sign" barCategoryGap="28%">
            <CartesianGrid {...GRID_PROPS} />
            <Customized
              component={<YearShading years={shownYears} selectedYear={Number(selectedYear)} unpublishedYears={unpublished.map((point) => point.year)} />}
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
              width={axisWidth(ticks, signedPounds)}
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
                  allValue={allAt}
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
              LINES.filter((line) => shown.includes(line.key)).map((line) => (
                <Line
                  key={line.key}
                  type="monotoneX"
                  dataKey={line.key}
                  name={line.label}
                  stroke={line.colour}
                  strokeWidth={line.width}
                  strokeOpacity={hovered && hovered !== line.key ? 0.3 : 1}
                  strokeDasharray={line.dash}
                  dot={{ r: line.key === FOCUS ? 4 : 2.5, fill: line.colour, stroke: CHART_COLOURS.surface, strokeWidth: 1.5 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              ))}
            {/* A wide invisible stroke over each line takes the hover */}
            {!byMeasure &&
              LINES.filter((line) => shown.includes(line.key)).map((line) => (
                <Line
                  key={`hit-${line.key}`}
                  type="monotoneX"
                  dataKey={line.key}
                  stroke="transparent"
                  strokeWidth={12}
                  dot={false}
                  activeDot={false}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                  onMouseEnter={() => setHovered(line.key)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            {!byMeasure && (
              <Customized component={<EndLabels data={data} lines={LINES.filter((line) => shown.includes(line.key))} hovered={hovered} onHover={setHovered} narrow={narrow} />} />
            )}
            {!cumulative && !phone && notes.length > 0 && (
              <Customized
                component={
                  <StepLabels
                    notes={notes}
                    valueAt={focusAt}
                    years={data.map((point) => point.year)}
                    paths={byMeasure ? [data.map((point) => point.net ?? null)] : shown.map((each) => data.map((point) => point[each] ?? null))}
                    columns={byMeasure ? stackColumns(data, partKeys) : []}
                  />
                }
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {/* The key, which also shows or hides each line; the shaded year is
            explained in the tooltip */}
        {!byMeasure && (
          <SeriesToggle
            series={[...LINES].reverse().map((line) => ({ key: line.key, label: line.label, colour: line.colour, dash: line.dash }))}
            shown={shown}
            onChange={setShown}
            onHover={setHovered}
            label="Lines"
            narrow={narrow}
          />
        )}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      <div className="chart-footer">
        {unpublished.length > 0 && (
          <Note>Not shown: {unpublished.map((point) => fiscalYearTick(point.year)).join(", ")} (not yet published, or too few survey records).</Note>
        )}
        <ChartMoreInfo
          members={byMeasure ? members : []}
          year={Number(selectedYear)}
          period={`in every year from ${first} to ${last}`}
          info={{ method: BY_YEAR_METHOD }}
        />
      </div>
    </div>
  );
}
