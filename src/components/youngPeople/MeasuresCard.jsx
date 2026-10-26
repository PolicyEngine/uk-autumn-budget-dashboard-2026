import { useRef, useState } from "react";
import MeasureRowLabel from "../MeasureRowLabel";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartCsv } from "../../utils/chartCsv";
import ChartDownloadMenu from "../ChartDownloadMenu";
import UnpublishedPlot from "../UnpublishedPlot";
import NoBreakYear from "../NoBreakYear";
import Note from "../Note";
import { fiscalYearTick, CHART_COLOURS } from "../../utils/chartTheme";
import ControlBar from "../ControlBar";
import { AGE_BANDS, YOUNG_BAND, isPublished } from "../../utils/ageImpact";
import { measureComparison, niceRange, pounds, signedPounds } from "./youngPeopleData";
import { NoEffectList } from "../personal/PolicyBars";
import { useMeasureCatalogue } from "../../utils/measureCatalogue";
import "./MeasureDumbbell.css";
import TitleIcon from "../TitleIcon";

/** "Aged 16 to 24", "Aged under 16", "Aged 65 and over". */
export const groupLabel = (band) => {
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
 * At most four intervals on the £ axis (−£200, −£100, £0, £100), so the
 * tick labels never run together in the card's narrow plot.
 */
export const DUMBBELL_MAX_STEPS = 4;

/**
 * Each policy as a row: a hollow ring for all ages and a filled dot for the
 * chosen group on one £ axis (zero line drawn), joined by a thin line
 * coloured by which is larger; the group's value and its gap to all ages at
 * the right. Hovering or focusing a row shows both values and the ratio.
 */
export function MeasureDumbbell({ rows, domain, ticks, groupName, yearLabel, height }) {
  const { byId } = useMeasureCatalogue();
  const [active, setActive] = useState(null);
  const [lo, hi] = domain;
  const pos = (value) => `${((value - lo) / (hi - lo)) * 100}%`;
  return (
    <div
      className="measure-dumbbell"
      role="table"
      aria-label={`Effect of each policy, ${yearLabel}`}
      style={height ? { "--md-height": `${height}px` } : undefined}
    >
      {rows.map((row) => {
        const gap = row.group - row.all;
        const close = Math.abs(gap) < 1;
        const tone = close ? "flat" : gap > 0 ? "more" : "less";
        const ratio =
          row.all !== 0 && Math.sign(row.all) === Math.sign(row.group)
            ? Math.round((row.group / row.all - 1) * 100)
            : null;
        const ratioText =
          ratio === null
            ? null
            : ratio === 0
              ? "about the same as the average person"
              : `${Math.abs(ratio)}% ${ratio > 0 ? "more" : "less"} than the average person`;
        const left = Math.min(row.group, row.all);
        const right = Math.max(row.group, row.all);
        return (
          <div
            key={row.id}
            className={`measure-dumbbell-row${active === row.id ? " is-active" : ""}`}
            role="row"
            tabIndex={0}
            onMouseEnter={() => setActive(row.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
            aria-label={`${row.name}: ${groupName} ${signedPounds(row.group)}, all ages ${signedPounds(row.all)} a year`}
          >
            <span className="measure-dumbbell-name" role="rowheader" title={row.name}>
              <MeasureRowLabel measure={byId.get(row.id) ?? { id: row.id, name: row.name }} />
            </span>
            <span className="measure-dumbbell-plot" role="cell" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick} className={`measure-dumbbell-grid${tick === 0 ? " is-zero" : ""}`} style={{ left: pos(tick) }} />
              ))}
              {!close && (
                <span className={`measure-dumbbell-link ${tone}`} style={{ left: pos(left), width: `calc(${pos(right)} - ${pos(left)})` }} />
              )}
              <span className="measure-dumbbell-ring" style={{ left: pos(row.all) }} />
              <span className="measure-dumbbell-dot" style={{ left: pos(row.group) }} />
            </span>
            <span className="measure-dumbbell-values" role="cell">
              <strong>{money(row.group)}</strong>
              <span className={`measure-dumbbell-gap ${tone}`}>
                {close ? "≈ all ages" : `${gap > 0 ? "▲" : "▼"} ${signed(gap)} vs all ages`}
              </span>
            </span>
            {active === row.id && (
              <span className="measure-dumbbell-tip" role="tooltip">
                <strong>
                  {row.name}, {yearLabel}
                </strong>
                <span>
                  {groupName}: {money(row.group)} a year
                </span>
                <span>All ages: {money(row.all)} a year</span>
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
          <span className="measure-dumbbell-plot">
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

export const measuresDescription = (band) => {
  const label = groupLabel(band).replace(/^Aged /, "");
  return `Each policy's average change per person: ${label} vs all ages.`;
};

const BAND_OPTIONS = AGE_BANDS.map((band) => ({ value: band.key, label: band.label }));

const UNIT = "Average change per person (£ a year)";

/**
 * "Which measures matter most": each selected policy's mean change for a
 * chosen age group (16 to 24 at first) beside its all-ages figure, in the
 * selected year. Every bar is one policy's own run, so nothing is added up.
 */
function MeasuresCard({ rows, policies, selectedPolicies, selectedYear, narrow, height }) {
  const { byId } = useMeasureCatalogue();
  const chartRef = useRef(null);
  const [band, setBand] = useState(YOUNG_BAND);
  const GROUPS = groupsFor(band);
  const description = measuresDescription(band);
  const yearLabel = fiscalYearTick(selectedYear);
  const published = isPublished(rows, selectedYear);
  const { shown, noEffect, suppressed } = measureComparison(
    rows,
    policies,
    selectedPolicies,
    selectedYear,
    band,
  );
  const values = shown.flatMap((point) => [point.group, point.all]);
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
  const notes = suppressed.length ? [`Not shown, too few survey records: ${suppressed.join(", ")}`] : [];
  // No effect: in the card's More info row, each with its colour. No reason
  // per measure: a list of them by id would be a measure list of the page's
  // own (the catalogue carries none)
  const noEffectItems = noEffect.map((policy) => ({
    ...policy,
    color: byId.get(policy.id)?.color,
  }));
  const csvText = () =>
    buildChartCsv({
      title: `Average change in household net income per person by policy, ${yearLabel}`,
      units:
        "£ per person per year; each policy's own effect; each person counts their household's change in net income (not equivalised)",
      columns: [
        { key: "name", label: "Policy" },
        { key: "group", label: GROUPS[0].label, decimals: 2 },
        { key: "all", label: "All ages", decimals: 2 },
      ],
      rows: published ? shown : [],
      notes,
    });
  const download = {
    chartRef,
    name: `young-people-change-by-policy-${band.replace("+", "-plus")}-${selectedYear}`,
    exportOptions,
    csv: csvText,
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
        <ControlBar name={title} options={[{ label: "Compare", value: band, onChange: setBand, options: BAND_OPTIONS }]} />
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
            yearLabel={yearLabel}
            height={height}
          />
        ) : (
          <div className="plot-empty" style={{ minHeight: height }} role="status">
            <p>{noEffect.length === selectedPolicies.length && selectedPolicies.length > 0
              ? `None of the selected policies changes household incomes in ${yearLabel}.`
              : `Results are unavailable for the selected policies in ${yearLabel}.`}</p>
          </div>
        )}
      </div>
      <div className="chart-legend">
        {published && shown.length > 0 && (
          <span className="measure-dumbbell-legend">
            <span>
              <i className="dot" /> {GROUPS[0].label.replace(/^Aged /, "")}
            </span>
            <span>
              <i className="ring" /> All ages
            </span>
          </span>
        )}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
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

export default MeasuresCard;
