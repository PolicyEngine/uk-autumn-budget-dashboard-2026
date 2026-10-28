import { useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Customized, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import ChartMoreInfo from "../ChartMoreInfo";
import ControlBar from "../ControlBar";
import { SectionMeasureKey, measureOpacity, useMeasureKey } from "../MeasureKey";
import Note from "../Note";
import NoBreakYear from "../NoBreakYear";
import TitleIcon from "../TitleIcon";
import UnpublishedPlot from "../UnpublishedPlot";
import ChartUnitLabel from "../../utils/ChartUnitLabel";
import { AGE_METHOD } from "../methodology/anchors";
import { X_AXIS_HEIGHT, plotMargin } from "../youngPeople/chartRows";
import { niceRange, singleAgeBars } from "../youngPeople/youngPeopleData";
import { pensionerAge, smoothByAge } from "../pensioners/pensionersData";
import {
  AXIS_LINE,
  AXIS_TITLE_STYLE,
  CHART_COLOURS,
  GRID_PROPS,
  HOVER_CURSOR,
  TICK_STYLE,
  axisWidth,
  barShape,
  fiscalYearTick,
} from "../../utils/chartTheme";
import { ALL_BAND, COMBINATION_NOT_PUBLISHED, SINGLE_AGE_TOP, isPublished, policiesWithoutRows, singleAgeKey, singleAgeSelection, withheldPartsCaveat } from "../../utils/ageImpact";
import { selectionPackageKey } from "../../utils/geography/selection";
import { legendMembership } from "../../utils/legendMembership";
import { PENSIONERS, ageWindow } from "../../utils/ageGroups";

const AGE_UNIT = "Average change per person (£ a year)";
const CSV_UNITS =
  "£ per person per year; each person counts their household's change in net income (not equivalised)";
const SHOW_OPTIONS = [
  { value: "net", label: "Net change", summary: "Net change" },
  { value: "measures", label: "Each policy", summary: "By policy" },
];

/** "+£12", "−£8", "£0": a change in pounds with a true minus. */
export const changeText = (value) => {
  const rounded = Math.round(value);
  if (rounded === 0) return "£0";
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return rounded > 0 ? `+${text}` : `−${text}`;
};

/**
 * Ticks every five years (ten on a phone) across the window, ending at 90+,
 * with the group's ends; a five-year tick too close to an end is dropped so
 * no two labels touch (a wide window packs its ages tighter).
 */
export function windowTicks([first, last], ends, narrow) {
  const every = narrow ? 10 : 5;
  const near = narrow ? 4 : last - first > 60 ? 3 : 2;
  const ticks = new Set();
  for (let age = Math.ceil(first / every) * every; age < last; age += every) {
    if (ends.every((end) => Math.abs(age - end) >= near) && last - age >= near) ticks.add(age);
  }
  for (const end of [first, ...ends, last]) ticks.add(end);
  return [...ticks].sort((a, b) => a - b).map(singleAgeKey);
}

/** "16 to 24", "67 to 90 and over": the window's ages in words. */
export const agesText = ([first, last]) => `${first} to ${last >= SINGLE_AGE_TOP ? "90 and over" : last}`;

// The text helpers live with the selection rule; re-exported for the tests
export { withheldPartsCaveat };

/** An age tick, the group's ends in bold teal. */
function AgeTick({ x, y, payload, ends }) {
  const own = ends.includes(payload.value);
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

/** "Age 72: +£15 a year", the five-year average, and the top measures in the breakdown. */
function AgeTooltip({ active, payload, nameOf, byMeasure }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || point.netChange === null) return null;
  const top = byMeasure
    ? [...point.parts].filter((part) => Math.abs(part.value) >= 0.5).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3)
    : [];
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        Age {point.label}: {changeText(point.netChange)} a year
      </p>
      {point.smooth !== null && !byMeasure && (
        <p className="chart-tooltip-note">Five-year average around this age: {changeText(point.smooth)} a year</p>
      )}
      {top.length > 0 && (
        <p className="chart-tooltip-note">Mostly: {top.map((part) => `${nameOf(part.id)} ${changeText(part.value)}`).join("; ")}</p>
      )}
    </div>
  );
}

/**
 * The average change per person by single year of age, for the chosen age
 * group's own ages (By age's Age group): one bar per age, gains and losses
 * in their colours, a five-year average through them so the shape reads
 * through single-year noise, and State Pension age marked. Options: each
 * measure's part stacked instead (the section's measure key highlights
 * them), offered only when no policy is too thin at some age (else the
 * reason is in About this chart's caveats). The £ axis fits the year shown.
 */
export default function SingleAgeCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height, group = PENSIONERS, extraOptions = [], title: titleBase = "Change by single year of age", keyInLegend = false }) {
  const chartRef = useRef(null);
  const [show, setShow] = useState("net");
  const byMeasure = show === "measures";
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  const spa = pensionerAge(year);
  const window = ageWindow(group, year);
  // The selection rule: the published package of exactly the selection
  // reads its own rows; other combinations draw whole or not at all
  const packageRun = selectionPackageKey(catalogue?.manifest, selectedPolicies);
  const selectAges = (each, first, last) =>
    singleAgeSelection(singleAgeBars(rows, policies, selectedPolicies, each, first, last), {
      rows,
      policies,
      selected: selectedPolicies,
      year: each,
      packageRun,
    });
  // The bars are the window's own ages, under the selection rule as one
  // set. The five-age average at each end also reads the two ages beyond
  // it (their net only, under the same rule), then only the window is kept
  const ageBars = (each) => {
    const inner = selectAges(each, window[0], window[1]);
    const first = Math.max(0, window[0] - 2);
    const last = Math.min(SINGLE_AGE_TOP, window[1] + 2);
    const outer = selectAges(each, first, last);
    const padded = [
      ...outer.filter((point) => point.age < window[0]),
      ...inner,
      ...outer.filter((point) => point.age > window[1]),
    ];
    return smoothByAge(padded).filter((point) => point.age >= window[0] && point.age <= window[1]);
  };
  const data = ageBars(year);
  const combinationUnavailable = data.some((point) => point.combinationUnavailable);
  // The package's net with no policy parts: drawn as the net bars
  const netOnly = data.some((point) => point.fromPackage && !point.partsShown);
  // By policy is offered only when every selected policy has rows at every
  // age shown: a policy withheld by single year of age is never backed out
  // of the package's own net, so then no policy parts are drawn at all.
  // Not even the other policies' parts: the Net change view of the same
  // chart shows the package's net at each age, and the net less the parts
  // shown would give the withheld policies' part back by difference
  const partsOffered = !netOnly && !combinationUnavailable;
  const stacked = byMeasure && partsOffered;
  // The selected policies with no row at some age shown, named in Caveats
  const windowLabels = Array.from({ length: window[1] - window[0] + 1 }, (_, i) => singleAgeKey(window[0] + i));
  const withheldNames = netOnly
    ? policiesWithoutRows(rows, policies, selectedPolicies, [year], windowLabels).map(
        (policy) => catalogue.byId.get(policy.id)?.label ?? policy.label ?? policy.name ?? policy.id,
      )
    : [];
  const partKeys = [...new Set(data.flatMap((point) => point.parts.map((part) => part.key)))];
  // Round £ ticks from the lowest to the highest in the year shown, through
  // £0: an axis fitted to every year zoomed one year's bars out to nothing
  const { domain, ticks } = useMemo(() => {
    const values = [0];
    for (const point of data) {
      if (point.netChange === null) continue;
      values.push(point.netChange);
      // The five-age line at an end reads ages beyond the window, so it can
      // pass the bars: the axis holds it too
      if (!stacked && Number.isFinite(point.smooth)) values.push(point.smooth);
      if (byMeasure) {
        values.push(point.parts.reduce((sum, part) => sum + Math.max(0, part.value), 0));
        values.push(point.parts.reduce((sum, part) => sum + Math.min(0, part.value), 0));
      }
    }
    return niceRange(Math.min(...values), Math.max(...values), { maxSteps: 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, policies, selectedPolicies, group, byMeasure, stacked, year, packageRun]);
  // With no policy parts (the package's own net, or a combination not
  // published by age) the parts are empty, not zero: no policy is then
  // listed as having no effect, as Age groups does (MeanChangeCard)
  const members = useMemo(
    () =>
      partsOffered
        ? legendMembership(catalogue, selectedPolicies, (id) =>
            data.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, policies, selectedPolicies, year, group, packageRun, partsOffered],
  );
  const key = useMeasureKey(stacked ? members : [], stacked ? "Net change" : undefined);
  const missing = data.filter((point) => point.netChange === null);
  const anyLoss = data.some((point) => (point.netChange ?? 0) < 0);
  const anyGain = data.some((point) => (point.netChange ?? 0) > 0);
  const nameOf = (id) => catalogue.byId.get(id)?.label ?? id;
  const showSpa = spa > window[0] && spa <= window[1] && (group === PENSIONERS || group === "65+" || group === ALL_BAND || window[1] >= spa);
  // The window is the group's own ages, so no end is picked out on the axis
  const tickEnds = [];
  const title = `${titleBase}, ${yearLabel}`;
  const description =
    group === ALL_BAND
      ? "Average change per person, £ a year, at each age."
      : `Average change per person, £ a year, at each age from ${agesText(window)}${group === PENSIONERS ? " (pensioners)" : ""}.`;
  const measureIds = [...new Set(data.flatMap((point) => point.parts.map((part) => part.id)))];
  const download = {
    chartRef,
    name: `change-by-single-age-${group}-${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: stacked
        ? []
        : [
            ...(anyGain ? [{ color: CHART_COLOURS.gain, label: "Gain", type: "rect" }] : []),
            ...(anyLoss ? [{ color: CHART_COLOURS.loss, label: "Loss", type: "rect" }] : []),
            { color: CHART_COLOURS.highlight, label: "Five-year average", type: "line" },
          ],
    },
    csv: () =>
      buildChartCsv({
        title: `Average change in household net income per person by single year of age, ${yearLabel}`,
        // Not "the sum of each policy's own effect": with a published run of
        // the whole selection (the default), Net change is that run's own row
        // (singleAgeSelection)
        units: `${CSV_UNITS}; the five-year average is centred on each age`,
        columns: [
          { key: "label", label: "Age" },
          ...measureIds.map((id) => ({ key: id, label: nameOf(id), decimals: 2 })),
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
    <div className="pensioners-age single-age-card">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="bars" />
            <span className="title-text">
              <NoBreakYear text={title} />
            </span>
          </h3>
          <p className="chart-description">{description}</p>
        </div>
        <ChartDownloadMenu download={download} chartTitle={title} />
      </div>
      <div className="chart-controls young-people-controls">
        <ControlBar
          name={title}
          options={[
            ...extraOptions,
            // Offered only when every selected policy has rows at every age
            // shown: else no Show choice at all (one usable option reads as
            // broken), and About this chart's caveats say why
            ...(partsOffered
              ? [{ label: "Show", value: show, onChange: setShow, options: SHOW_OPTIONS }]
              : []),
          ]}
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : combinationUnavailable ? (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{COMBINATION_NOT_PUBLISHED}</p>
          </div>
        ) : missing.length === data.length ? (
          // The window is the group's own ages: when none has enough survey
          // records, say so rather than draw an empty plot
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{`Not shown: too few survey records at every age from ${agesText(window)}.`}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={plotMargin(narrow)} barCategoryGap="12%" stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="label"
                ticks={windowTicks(window, [], narrow)}
                interval={0}
                tick={<AgeTick ends={tickEnds} />}
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
              <Tooltip {...TOOLTIP_PROPS} cursor={HOVER_CURSOR} content={<AgeTooltip nameOf={nameOf} byMeasure={stacked} />} />
              {stacked ? (
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
                ))
              ) : (
                <Bar dataKey="netChange" name="Change" isAnimationActive={false} legendType="none" shape={barShape(["netChange"])}>
                  {data.map((point) => (
                    <Cell
                      key={point.label}
                      fill={(point.netChange ?? 0) < 0 ? CHART_COLOURS.loss : CHART_COLOURS.gain}
                      fillOpacity={0.55}
                    />
                  ))}
                </Bar>
              )}
              <ReferenceLine y={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={1} />
              {!stacked && (
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
              )}
              {showSpa && (
                <ReferenceLine
                  x={singleAgeKey(spa)}
                  stroke={CHART_COLOURS.highlight}
                  strokeDasharray="4 3"
                  label={{
                    value: narrow ? `Pension age ${spa}` : `State Pension age, ${spa}`,
                    // Near the left end, the label reads to the right of the line
                    position: spa - window[0] < (window[1] - window[0]) / 2 ? "insideTopLeft" : "insideTopRight",
                    fill: CHART_COLOURS.highlight,
                    fontSize: TICK_STYLE.fontSize,
                    fontWeight: 600,
                  }}
                />
              )}
              <Customized component={<ChartUnitLabel text={AGE_UNIT} />} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="chart-legend">
        {published && !stacked && !combinationUnavailable && (
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
        {/* By age: the section's shared key, in this legend row */}
        {published && key.shared && keyInLegend && !combinationUnavailable && <SectionMeasureKey placement="card" />}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {published && (
        <div className="chart-footer">
          <ChartMoreInfo
            members={members}
            year={year}
            info={{
              caveats: [
                netOnly && withheldPartsCaveat(withheldNames),
                missing.length > 0 && !combinationUnavailable && `Not shown, as too few survey records: ages ${missing.map((p) => p.label).join(", ")}.`,
              ],
              how: [
                `One bar per single year of age, ${agesText(window)}.`,
                "The line averages the five ages centred on each one, as single ages rest on few survey records.",
                showSpa && `The dashed line marks State Pension age (${spa} in ${yearLabel}), where pensioners start.`,
                partsOffered && "With Show set to Each policy, each selected policy's part is stacked at each age.",
              ],
              method: AGE_METHOD,
            }}
          />
        </div>
      )}
    </div>
  );
}
