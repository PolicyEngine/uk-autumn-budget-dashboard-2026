import { useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Customized, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Tooltip } from "../ViewportTooltip";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { TOOLTIP_PROPS } from "../ChartTooltip";
import ChartMoreInfo from "../ChartMoreInfo";
import ControlBar from "../ControlBar";
import { measureOpacity, useMeasureKey } from "../MeasureKey";
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
import { ALL_BAND, isPublished, singleAgeKey } from "../../utils/ageImpact";
import { DISPLAY_YEARS } from "../../utils/displayYears";
import { legendMembership } from "../../utils/legendMembership";
import { PENSIONERS, ageWindow, groupAges, groupLabel } from "../../utils/ageGroups";

const AGE_UNIT = "Average change per person (£ a year)";
const CSV_UNITS =
  "£ per person per year; each person counts their household's change in net income (not equivalised)";
const GROUP_FILL = CHART_COLOURS.highlightBand;
const SHOW_OPTIONS = [
  { value: "net", label: "Net change", summary: "Net change" },
  { value: "measures", label: "Each measure", summary: "By measure" },
];

/** "+£12", "−£8", "£0": a change in pounds with a true minus. */
export const changeText = (value) => {
  const rounded = Math.round(value);
  if (rounded === 0) return "£0";
  const text = `£${Math.abs(rounded).toLocaleString("en-GB")}`;
  return rounded > 0 ? `+${text}` : `−${text}`;
};

/** Ticks every five years (ten on a phone) across the window, and the group's ends. */
function windowTicks([first, last], ends, narrow) {
  const every = narrow ? 10 : 5;
  const ticks = new Set();
  for (let age = Math.ceil(first / every) * every; age < last; age += every) {
    if (ends.every((end) => Math.abs(age - end) >= (narrow ? 4 : 2))) ticks.add(age);
  }
  for (const end of [first, ...ends, last]) ticks.add(end);
  return [...ticks].sort((a, b) => a - b).map(singleAgeKey);
}

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
 * The average change per person by single year of age, in a window around
 * the chosen age group (By age's Age group): one bar per age, gains and
 * losses in their colours, a five-year average through them so the shape
 * reads through single-year noise, the group's ages shaded and State
 * Pension age marked. Options: each measure's part stacked instead (the
 * section's measure key highlights them). One axis for every year, so Play
 * shows the change between years.
 */
export default function SingleAgeCard({ catalogue, rows, policies, selectedPolicies, selectedYear, narrow, height, group = PENSIONERS, extraOptions = [], title: titleBase = "Change by single year of age" }) {
  const chartRef = useRef(null);
  const [show, setShow] = useState("net");
  const byMeasure = show === "measures";
  const year = Number(selectedYear);
  const yearLabel = fiscalYearTick(year);
  const published = isPublished(rows, year);
  const spa = pensionerAge(year);
  const window = ageWindow(group, year);
  const [groupFirst, groupLast] = groupAges(group, year);
  const ageBars = (each) => smoothByAge(singleAgeBars(rows, policies, selectedPolicies, each, window[0], window[1]));
  const data = ageBars(year);
  const partKeys = [...new Set(data.flatMap((point) => point.parts.map((part) => part.key)))];
  // Round £ ticks from the lowest to the highest in any year shown, through
  // £0, so the scale holds still under Play
  const { domain, ticks } = useMemo(() => {
    const values = [0];
    for (const each of DISPLAY_YEARS) {
      for (const point of ageBars(each)) {
        if (point.netChange === null) continue;
        values.push(point.netChange);
        if (byMeasure) {
          values.push(point.parts.reduce((sum, part) => sum + Math.max(0, part.value), 0));
          values.push(point.parts.reduce((sum, part) => sum + Math.min(0, part.value), 0));
        }
      }
    }
    return niceRange(Math.min(...values), Math.max(...values), { maxSteps: 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, policies, selectedPolicies, group, byMeasure]);
  const members = useMemo(
    () =>
      legendMembership(catalogue, selectedPolicies, (id) =>
        data.some((point) => point.parts.some((part) => part.id === id && Math.abs(part.value) > 0)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, policies, selectedPolicies, year, group],
  );
  const key = useMeasureKey(byMeasure ? members : [], byMeasure ? "Net change" : undefined);
  const missing = data.filter((point) => point.netChange === null);
  const anyLoss = data.some((point) => (point.netChange ?? 0) < 0);
  const anyGain = data.some((point) => (point.netChange ?? 0) > 0);
  const nameOf = (id) => catalogue.byId.get(id)?.label ?? id;
  const showSpa = spa >= window[0] && spa <= window[1] && (group === PENSIONERS || group === "65+" || group === ALL_BAND || window[1] >= spa);
  const ends = group === ALL_BAND ? [] : [singleAgeKey(groupFirst), singleAgeKey(groupLast)];
  const tickEnds = [...ends, ...(showSpa ? [singleAgeKey(spa)] : [])];
  const title = `${titleBase}, ${yearLabel}`;
  const description =
    group === ALL_BAND
      ? "Average change per person, £ a year, at each age."
      : `Average change per person, £ a year, at each age; ${group === PENSIONERS ? "pensioners' ages" : groupLabel(group)} shaded.`;
  const measureIds = [...new Set(data.flatMap((point) => point.parts.map((part) => part.id)))];
  const download = {
    chartRef,
    name: `change-by-single-age-${group}-${year}`,
    exportOptions: {
      title,
      description,
      logo: CHART_LOGO,
      reservedLegendHeight: 0,
      legendItems: byMeasure
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
        units: `${CSV_UNITS}; the sum of each selected policy's own effect; the five-year average is centred on each age`,
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
        <ControlBar name={title} options={[...extraOptions, { label: "Show", value: show, onChange: setShow, options: SHOW_OPTIONS }]} />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={data} margin={plotMargin(narrow)} barCategoryGap="12%" stackOffset="sign">
              <CartesianGrid {...GRID_PROPS} />
              {group !== ALL_BAND && (
                <ReferenceArea x1={singleAgeKey(Math.max(groupFirst, window[0]))} x2={singleAgeKey(groupLast)} fill={GROUP_FILL} ifOverflow="visible" />
              )}
              <XAxis
                dataKey="label"
                ticks={windowTicks(window, [groupFirst, groupLast, ...(showSpa ? [spa] : [])].filter((age) => age >= window[0] && age <= window[1]), narrow)}
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
              <Tooltip {...TOOLTIP_PROPS} cursor={HOVER_CURSOR} content={<AgeTooltip nameOf={nameOf} byMeasure={byMeasure} />} />
              {byMeasure ? (
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
              {!byMeasure && (
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
                    position: "insideTopRight",
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
        {published && !byMeasure && (
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
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
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
                `One bar per single year of age, ${window[0]} to ${window[1] >= 90 ? "90 and over" : window[1]}: the sum of each selected policy's own effect.`,
                "The line averages the five ages centred on each one, as single ages rest on few survey records.",
                showSpa && `The dashed line marks State Pension age (${spa} in ${yearLabel}); pensioners are the ages from it.`,
                "Each measure shows every selected measure's own part at each age, stacked.",
              ],
              method: AGE_METHOD,
            }}
          />
        </div>
      )}
    </div>
  );
}
