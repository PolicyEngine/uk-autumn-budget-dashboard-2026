import { useEffect, useRef, useState } from "react";
import { groupSubject } from "../../utils/ageGroups";
import MeasureRowLabel, { measureCategory } from "../MeasureRowLabel";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import UnpublishedPlot from "../UnpublishedPlot";
import NoBreakYear from "../NoBreakYear";
import Note from "../Note";
import { fiscalYearTick, CHART_COLOURS, fitTicks, magnitudeColours, emptyMeasuresNote } from "../../utils/chartTheme";
import useElementWidth from "../../hooks/useElementWidth";
import ControlBar from "../ControlBar";
import { AGE_BANDS, ALL_BAND, YOUNG_BAND, isPublished } from "../../utils/ageImpact";
import { measureComparison, niceRange, pounds, signedPounds } from "./youngPeopleData";
import { pensionerMeasures } from "../pensioners/pensionersData";
import { NoEffectList } from "../personal/PolicyBars";
import { AGE_METHOD } from "../methodology/anchors";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import { noEffectRow } from "../../utils/legendMembership";
import "./MeasureDumbbell.css";
import TitleIcon from "../TitleIcon";


// The card's About this chart (the measures with no effect join its caveats)
const MEASURES_INFO = {
  method: AGE_METHOD,
};

/** "Aged 16 to 24", "Aged under 16", "Aged 65 and over". */
export const groupLabel = (band) => {
  if (band === "pensioners") return "Pensioners";
  if (band === ALL_BAND) return "All ages";
  const label = AGE_BANDS.find((candidate) => candidate.key === band)?.label ?? band;
  return `Aged ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

/** The two bars per measure: the chosen age group, and all ages. */
export const groupsFor = (band) => [
  { key: "group", label: groupLabel(band), color: CHART_COLOURS.gain },
  { key: "all", label: "All ages", color: CHART_COLOURS.reference },
];

/** £ a year with a sign, the minus a true minus: "+£6", "−£4". */
const signed = (value) => (value < 0 ? `\u2212${pounds(-value)}` : `+${pounds(value)}`);

/** £ a year, the minus a true minus and no plus: "£22", "−£196". */
export const money = (value) => (Math.round(value) < 0 ? `\u2212${pounds(-value)}` : pounds(value));

/**
 * At most four intervals on the £ axis (−£200, −£100, £0, £100); the
 * dumbbell then labels only the ticks its measured plot has room for
 * (chartTheme.fitTicks).
 */
export const DUMBBELL_MAX_STEPS = 4;

/**
 * Each policy as a row: a hollow ring for all ages and a filled dot for the
 * chosen group (teal for a gain, amber for a loss, darker the larger) on one £ axis (zero line drawn), joined by a thin line
 * coloured by which is larger; the group's value and its gap to all ages at
 * the right. Hovering or focusing a row shows both values and the ratio.
 */
export function MeasureDumbbell({ rows, domain, ticks: allTicks, groupName, yearLabel, height, compareName = "All ages", single = false }) {
  const { byId } = useMeasureCatalogue();
  const [active, setActive] = useState(null);
  // The ticks whose labels fit the plot (always £0); gridlines at the same
  const [plotRef, plotWidth] = useElementWidth();
  const ticks = fitTicks(allTicks, domain, plotWidth, money);
  const [lo, hi] = domain;
  const pos = (value) => `${((value - lo) / (hi - lo)) * 100}%`;
  // The group's dot by direction and size: a gain in the teal ramp, a loss
  // in the amber, the largest darkest (magnitudeColours)
  const dotColours = magnitudeColours(rows.map((row) => row.group ?? 0));
  return (
    <div
      className="measure-dumbbell"
      role="table"
      aria-label={`Effect of each policy, ${yearLabel}`}
      style={height ? { "--md-height": `${height}px` } : undefined}
    >
      {rows.map((row, index) => {
        // A figure withheld for one of the two groups is null: the row
        // shows the other alone, with no link, gap or ratio
        const hasGroup = row.group !== null && row.group !== undefined;
        const hasAll = !single && row.all !== null && row.all !== undefined;
        const half = !hasGroup || (!single && !hasAll);
        const gap = half ? 0 : row.group - row.all;
        // With nothing to compare (all ages against all ages) the row has
        // the dot and its value only
        const close = single || half || Math.abs(gap) < 1;
        const tone = close ? "flat" : gap > 0 ? "more" : "less";
        const ratio =
          !single && !half && row.all !== 0 && Math.sign(row.all) === Math.sign(row.group)
            ? Math.round((row.group / row.all - 1) * 100)
            : null;
        const ratioText =
          ratio === null
            ? null
            : ratio === 0
              ? `about the same as the ${compareName.toLowerCase()} figure`
              : // Against what Compare with names, by size (both figures have
                // one sign): for two losses "more" would read as a gain
                `${Math.abs(ratio)}% ${ratio > 0 ? "larger" : "smaller"} than the ${compareName.toLowerCase()} figure`;
        const left = half ? 0 : Math.min(row.group, row.all);
        const right = half ? 0 : Math.max(row.group, row.all);
        const parts = [
          hasGroup && `${groupName} ${signedPounds(row.group)}`,
          hasAll && `${compareName.toLowerCase()} ${signedPounds(row.all)}`,
        ].filter(Boolean);
        return (
          <div
            key={row.id}
            className={`measure-dumbbell-row row-band${index % 2 === 0 ? " is-banded" : ""}${active === row.id ? " is-active" : ""}`}
            role="row"
            tabIndex={0}
            onMouseEnter={() => setActive(row.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
            aria-label={`${row.name}: ${parts.join(", ")} a year`}
          >
            {/* The row's one tip is its tooltip below (full name as its
                heading): no title or name tip of its own */}
            <span className="measure-dumbbell-name" role="rowheader">
              <MeasureRowLabel measure={byId.get(row.id) ?? { id: row.id, name: row.name }} tip={false} />
            </span>
            <span className="measure-dumbbell-plot" role="cell" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick} className={`measure-dumbbell-grid${tick === 0 ? " is-zero" : ""}`} style={{ left: pos(tick) }} />
              ))}
              {!close && (
                <span className={`measure-dumbbell-link ${tone}`} style={{ left: pos(left), width: `calc(${pos(right)} - ${pos(left)})` }} />
              )}
              {hasAll && <span className="measure-dumbbell-ring" style={{ left: pos(row.all) }} />}
              {hasGroup && <span className="measure-dumbbell-dot" style={{ left: pos(row.group), background: dotColours[index] }} />}
            </span>
            <span className="measure-dumbbell-values" role="cell">
              {hasGroup && <strong className="row-band-value">{money(row.group)}</strong>}
              {!single && !half && (
                <span className={`measure-dumbbell-gap ${tone}`}>
                  {close ? `≈ ${compareName.toLowerCase()}` : `${gap > 0 ? "▲" : "▼"} ${signed(gap)} vs ${compareName.toLowerCase()}`}
                </span>
              )}
              {!hasGroup && hasAll && (
                <span className="measure-dumbbell-gap flat">
                  {compareName}: {money(row.all)}
                </span>
              )}
            </span>
            {active === row.id && (
              <span className="measure-dumbbell-tip" role="tooltip">
                <strong>
                  {row.name}, {yearLabel}
                </strong>
                {/* The category, which a compact row leaves out of its name */}
                <span className="measure-dumbbell-tip-category">{measureCategory(byId.get(row.id) ?? { id: row.id, name: row.name })}</span>
                {hasGroup && (
                  <span>
                    {groupName}: {money(row.group)} a year
                  </span>
                )}
                {hasAll && <span>{compareName}: {money(row.all)} a year</span>}
                {ratioText && <span>{ratioText}</span>}
              </span>
            )}
          </div>
        );
      })}
      {/* The ticks, then the unit: the same height as a Recharts x axis
          (X_AXIS_HEIGHT), so in a pair the axis titles line up */}
      <div className="measure-dumbbell-axis" aria-hidden="true">
        <div className="measure-dumbbell-row">
          <span className="measure-dumbbell-name" />
          <span className="measure-dumbbell-plot" ref={plotRef}>
            {ticks.map((tick) => (
              <span key={tick} className="measure-dumbbell-tick" style={{ left: pos(tick) }}>
                {money(tick)}
              </span>
            ))}
          </span>
          <span className="measure-dumbbell-values" />
        </div>
        <p className="measure-dumbbell-unit">{UNIT}</p>
      </div>
    </div>
  );
}

/** "Average change in household income from each policy, for 16 to 24-year-olds and people of all ages." */
export const measuresDescription = (band, compareKey = ALL_BAND) =>
  `Average change in household income from each policy, for ${groupSubject(band).toLowerCase()} and ${groupSubject(compareKey).toLowerCase()}.`;

const BAND_OPTIONS = [
  ...AGE_BANDS.map((band) => ({ value: band.key, label: band.label })),
  { value: "pensioners", label: "Pensioners" },
];

const UNIT = "Average change in household income, per person (£ a year)";

/**
 * "Which measures matter most": each selected policy's mean change for a
 * chosen age group (16 to 24 at first) beside its all-ages figure, in the
 * selected year. Every bar is one policy's own run, so nothing is added up.
 */
function MeasuresCard({ rows, policies, selectedPolicies, selectedYear, narrow, height, group = YOUNG_BAND, extraOptions = [], defaultCompare = ALL_BAND }) {
  const { byId } = useMeasureCatalogue();
  const chartRef = useRef(null);
  // The section's age group (By age), which the card's Compare can override
  // until the section's group changes again
  const [band, setBand] = useState(group);
  useEffect(() => {
    setBand(group);
  }, [group]);
  // What the group is compared with: all ages, or another age band (By age
  // opens on 25 to 34, defaultCompare; all ages when that is the group)
  const [compareWith, setCompareWith] = useState(defaultCompare);
  const compareKey = compareWith === band ? ALL_BAND : compareWith;
  // All ages chosen as the group: nothing to compare it with
  const single = band === compareKey;
  const compareName = compareKey === ALL_BAND ? "All ages" : AGE_BANDS.find((b) => b.key === compareKey)?.label ?? compareKey;
  const GROUPS = groupsFor(band).map((item) => (item.key === "all" ? { ...item, label: compareName } : item));
  const description = single
    ? "Average change in household income from each policy, for people of all ages."
    : measuresDescription(band, compareKey);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  // A policy withheld for the group is left out, with no note (Vahid, 29 Oct)
  const { shown, noEffect } =
    band === "pensioners"
      ? pensionerMeasures(rows, policies, selectedPolicies, selectedYear, compareKey)
      : measureComparison(rows, policies, selectedPolicies, selectedYear, band, compareKey);
  const values = shown.flatMap((point) => [point.group, point.all]).filter(Number.isFinite);
  const { domain, ticks } = niceRange(Math.min(0, ...values), Math.max(0, ...values), {
    maxSteps: DUMBBELL_MAX_STEPS,
  });

  const title = `Effect of each policy, ${yearLabel}`;
  const exportOptions = {
    title,
    description,
    logo: CHART_LOGO,
    reservedLegendHeight: 0,
    legendItems: GROUPS.map((group) => ({ color: group.color, label: group.label, type: "rect" })),
  };
  // No effect: in the card's About this chart, each by its short name, and
  // when it is in force where that is not this year
  const noEffectItems = noEffect.map((policy) => ({
    ...policy,
    ...noEffectRow(byId.get(policy.id) ?? policy, Number(selectedYear)),
  }));
  const csvText = () =>
    buildChartCsv({
      title: `Average change in household net income per person by policy, ${yearLabel}`,
      units:
        "£ per person per year; each policy's own effect; each person counts their household's change in net income (not equivalised)",
      columns: [
        { key: "name", label: "Policy" },
        { key: "group", label: GROUPS[0].label, decimals: 2 },
        { key: "all", label: compareName, decimals: 2 },
      ],
      rows: published ? shown : [],
    });
  const download = {
    chartRef,
    name: `young-people-change-by-policy-${band.replace("+", "-plus")}-${selectedYear}`,
    exportOptions,
    csv: csvText,
    // The dumbbell is drawn in HTML: its images are redrawn from the page
    // (chartDownloads)
    published: published && shown.length > 0,
  };

  return (
    <div className="young-people-measures">
      <div className="chart-header">
        <div>
          <h3>
            <TitleIcon name="hbars" />
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
          options={
            extraOptions.length
              ? // By age: its age group, then what to compare it with
                [
                  ...extraOptions,
                  {
                    label: "Compare with",
                    value: compareKey,
                    onChange: setCompareWith,
                    // All ages against all ages: the pill reads "All ages" once
                    ...(single ? { omitAtDefault: ALL_BAND } : {}),
                    options: [
                      { value: ALL_BAND, label: "All ages" },
                      ...AGE_BANDS.filter((b) => b.key !== band).map((b) => ({ value: b.key, label: b.label })),
                    ],
                  },
                ]
              : [{ label: "Compare", value: band, onChange: setBand, options: BAND_OPTIONS }]
          }
        />
      </div>
      <div ref={chartRef} className="chart-plot young-people-plot">
        {!published ? (
          <UnpublishedPlot height={height} yearLabel={yearLabel} />
        ) : shown.length ? (
          <MeasureDumbbell
            rows={shown}
            domain={domain}
            ticks={ticks}
            groupName={GROUPS[0].label.replace(/^Aged /, "")}
            compareName={compareName}
            yearLabel={yearLabel}
            single={single}
            height={height}
          />
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{emptyMeasuresNote({ noEffect, selectedPolicies, yearLabel })}</p>
          </div>
        )}
      </div>
      <div className="chart-legend">
        {published && shown.length > 0 && (
          <span className="measure-dumbbell-legend">
            <span>
              <i className="dot" /> {GROUPS[0].label.replace(/^Aged /, "")}
            </span>
            {!single && (
              <span>
                <i className="ring" /> {compareName}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
      {/* Notes and About this chart in the card's footer row, level across a pair */}
      {published && (
        <div className="chart-footer">
          <NoEffectList
            items={noEffectItems}
            title={`No effect in ${yearLabel}`}
            info={MEASURES_INFO}
          />
        </div>
      )}
    </div>
  );
}

export default MeasuresCard;
