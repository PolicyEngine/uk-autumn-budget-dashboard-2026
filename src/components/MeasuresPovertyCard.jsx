// Which measures move poverty: a waterfall of people moved out of (or into)
// poverty in the selected year. Each selected measure's own effect (its own
// run in metrics.csv) is a step in its colour, largest first; where the
// steps do not add up to the package (the combined run), an "interaction"
// step closes the gap; the package total ends it. People are the change in
// the rate times the outlook's population that year (povertyPeople.js);
// without a population the card falls back to percentage points
// throughout. Measures that move no one are one muted line, not empty rows.
// The poverty choice is shared with the Change in the poverty rate chart
// beside it (usePovertyChoice, ?poverty=).

import { useRef } from "react";
import LsCard from "./livingStandards/LsCard";
import PillSelect from "./PillSelect";
import ChartMoreInfo from "./ChartMoreInfo";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import SummaryMetricChart, { SUMMARY_METRICS, hasColumn, povertyMetric, usePovertyChoice } from "./SummaryMetricChart";
import { useOutlook } from "./livingStandards/useOutlook";
import { formatPp, outlookPopulation } from "../utils/povertyPeople";
import { CHART_COLOURS, fiscalYearTick } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { COMBINED_REFORM_ID, POLICY_COLORS, shortName } from "../utils/policyConfig";
import { legendMembership } from "../utils/legendMembership";
import { wholeSelectionRun } from "../utils/ageImpact";
import "./livingStandards/LivingStandards.css";
import "./MeasuresPovertyCard.css";

// Why a measure moves no one across the poverty line, where the model says
// so by construction: poverty is measured on household income (HBAI), which
// counts neither prices nor capital gains
const NO_EFFECT_REASON = {
  fuel_duty_rise_deferral: "prices",
  road_fuel_vat_cut: "prices",
  domestic_electricity_zero_vat: "prices",
  badr_lifetime_limit_cut: "gains",
};

/**
 * The measures' own changes in the poverty rate (pp) in `year`, for the
 * measures that change incomes that year ({members} lists all, £0 ones
 * muted), and the package's (the combined run) when one run covers the
 * selection.
 */
export function measurePovertyRows(rows, policies, selectedPolicies, year, key) {
  const rowFor = (id) => (rows ?? []).find((row) => row.reform_id === id && Number(row.year) === year);
  const members = legendMembership(selectedPolicies, (id) => Number(rowFor(id)?.people_affected) > 0);
  const measures = members
    .filter((member) => !member.muted)
    .map((member) => ({
      id: member.id,
      name: shortName(member.id),
      value: Number(rowFor(member.id)?.[key]) || 0,
      colour: POLICY_COLORS[member.name],
    }));
  const run = wholeSelectionRun(policies, selectedPolicies);
  const total = run === COMBINED_REFORM_ID ? Number(rowFor(run)?.[key]) : NaN;
  return { members, measures, total: Number.isFinite(total) ? total : null };
}

/**
 * The waterfall's rows from the measures' changes (pp): x is people moved
 * out of poverty (or, with no population, −pp), so a fall in poverty
 * steps right. Steps by size, then an interaction step where they miss
 * the package by more than rounding, then the total from 0.
 * Returns { steps, zero, peopleMode }; each step is
 * { id, name, pp, x, start, end, colour, kind: "measure" | "interaction" | "total" }.
 */
export function povertyWaterfall(measures, total, millions) {
  const peopleMode = Boolean(millions);
  const toX = (pp) => (peopleMode ? -(pp / 100) * millions * 1e6 : -pp);
  const zero = measures.filter((m) => m.value === 0);
  const moving = measures.filter((m) => m.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  let at = 0;
  const steps = moving.map((m) => {
    const x = toX(m.value);
    const step = { id: m.id, name: m.name, pp: m.value, x, start: at, end: at + x, colour: m.colour, kind: "measure" };
    at += x;
    return step;
  });
  if (total !== null) {
    const gap = total - moving.reduce((sum, m) => sum + m.value, 0);
    // More than rounding: 500 people, or 0.0005pp without a population
    if (Math.abs(toX(gap)) >= (peopleMode ? 500 : 0.0005)) {
      const x = toX(gap);
      steps.push({ id: "interaction", name: "Interaction", pp: gap, x, start: at, end: at + x, colour: CHART_COLOURS.noChange, kind: "interaction" });
    }
    const x = toX(total);
    steps.push({ id: COMBINED_REFORM_ID, name: "Package", pp: total, x, start: 0, end: x, colour: CHART_COLOURS.reference, kind: "total" });
  }
  return { steps, zero, peopleMode };
}

const thousands = new Intl.NumberFormat("en-GB");

/** Round axis ticks over [lo, hi]: people in 1, 2 or 5 × 10^k steps, at most five. */
function niceTicks(lo, hi) {
  const span = Math.max(hi - lo, 1e-12);
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => span / s <= 4.0001) ?? 10 * power;
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = first; t <= last + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return ticks;
}

export default function MeasuresPovertyCard({ rows, policies, selectedPolicies, selectedYear, population }) {
  const plotRef = useRef(null);
  const { poverty, controls } = usePovertyChoice();
  const metric = povertyMetric(poverty);
  const { tip, handlers } = useFloatingTooltip(plotRef, `${metric.key}-${selectedYear}`);
  if (!hasColumn(rows, metric.key)) return null;

  const year = fiscalYearTick(selectedYear);
  const { members, measures, total } = measurePovertyRows(rows, policies, selectedPolicies, selectedYear, metric.key);
  const millions = population ? population(selectedYear, poverty.group) : null;
  const { steps, zero, peopleMode } = povertyWaterfall(measures, total, millions);
  const who = poverty.group === "children" ? "children" : "people";

  // "≈4,000 fewer" (people) or "−0.005pp" (no population)
  const main = (step, noun = false) => {
    if (!peopleMode) return formatPp(step.pp);
    const n = Math.abs(step.x);
    const way = step.x > 0 ? "fewer" : "more";
    const count = n < 1000 ? "<1,000" : `≈${thousands.format(Math.round(n / 1000) * 1000)}`;
    return `${count} ${way}${noun ? ` ${who}` : ""}`;
  };
  const tickText = (t) =>
    peopleMode ? (t === 0 ? "0" : `${t < 0 ? "−" : ""}${thousands.format(Math.abs(t))}`) : t === 0 ? "0" : formatPp(-t).replace("pp", "");

  const ends = steps.flatMap((s) => [s.start, s.end]).concat(0);
  const ticks = niceTicks(Math.min(...ends), Math.max(...ends));
  const [x0, x1] = [ticks[0], ticks.at(-1)];
  const pos = (v) => (x1 === x0 ? 50 : ((v - x0) / (x1 - x0)) * 100);

  const measureSteps = steps.filter((s) => s.kind === "measure");
  const top = measureSteps[0];
  const totalStep = steps.find((s) => s.kind === "total");
  const interaction = steps.find((s) => s.kind === "interaction");
  const summary = top ? (
    <>
      Biggest: {top.name}, <strong>{main(top, true)}</strong>
      {peopleMode && <> ({formatPp(top.pp)})</>}.
      {totalStep && (
        <>
          {" "}
          Package: <strong>{main(totalStep)}</strong>.
        </>
      )}
    </>
  ) : (
    <>No measure on its own moves anyone across this line in {year}.</>
  );

  const reasons = [...new Set(zero.map((m) => NO_EFFECT_REASON[m.id]).filter(Boolean))];
  const zeroInfo = [
    reasons.includes("prices") && "VAT and fuel duty change prices, which the household income poverty is measured on does not count.",
    reasons.includes("gains") && "Business Asset Disposal Relief taxes capital gains, which that income leaves out too.",
    zero.some((m) => !NO_EFFECT_REASON[m.id]) && `The others change incomes in ${year} but move no one across this line on their own.`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <LsCard
      title="Which measures move poverty"
      icon="bars"
      period={year}
      summary={
        <>
          {peopleMode ? `${metric.short.replace(/, pp$/, "")}, people` : metric.short}, by measure. {summary}
        </>
      }
      download={{
        filename: `${metric.file}-by-measure-${selectedYear}`,
        image: false,
        csv: () =>
          buildChartCsv({
            title: `${metric.title} by measure, ${year}`,
            units: metric.csvUnits,
            columns: [
              { key: "name", label: "Measure" },
              { key: "pp", label: "Change (pp)", decimals: 4 },
              ...(peopleMode ? [{ key: "people", label: `Change in ${who} in poverty`, decimals: 0 }] : []),
            ],
            rows: [...steps, ...zero.map((m) => ({ name: m.name, pp: 0, x: 0 }))].map((s) => ({
              name: s.name,
              pp: s.pp,
              people: -s.x,
            })),
          }),
      }}
      controls={controls.map((control) => (
        <PillSelect
          key={control.label}
          variant="light"
          prefix={control.label}
          name={control.label}
          options={control.options}
          value={control.value}
          onChange={control.onChange}
        />
      ))}
      footer={
        <ChartMoreInfo members={members} year={selectedYear}>
          <p>
            Each step is a selected measure modelled on its own, largest first, and the package bar all of them together,
            in {year}: the change in {metric.phrase}.{metric.detail ? ` ${metric.detail}` : ""}
            {peopleMode && ` People are that change times the ${who === "children" ? "children" : "population"} in ${year}, from the current-law projection, to the nearest 1,000.`}
          </p>
          <p>
            Measures can reach the same households, so their separate effects need not add up to the package&apos;s.
            {interaction &&
              ` Here they miss it by ${main(interaction, true).replace(/^≈/, "about ")}, shown as the interaction step.`}
          </p>
        </ChartMoreInfo>
      }
    >
      <div className="chart-plot">
        <div ref={plotRef} className="wf" role="table" aria-label={`${metric.title} by measure, ${year}`}>
          {steps.map((step, i) => {
            const left = Math.min(pos(step.start), pos(step.end));
            const width = Math.max(Math.abs(pos(step.end) - pos(step.start)), 0.6);
            return (
              <div className={`wf-row wf-${step.kind}`} role="row" key={step.id}>
                <span className="wf-label" role="rowheader">
                  {step.kind === "measure" && <i className="wf-key" style={{ background: step.colour }} />}
                  {step.name}
                </span>
                <span
                  className="wf-track has-tooltip"
                  role="cell"
                  tabIndex={0}
                  aria-label={`${main(step, true)}, ${formatPp(step.pp)}`}
                  {...handlers(
                    step.id,
                    <TooltipRows
                      label={`${step.name}, ${year}`}
                      rows={[
                        ...(peopleMode ? [{ key: "people", name: `${who[0].toUpperCase()}${who.slice(1)} in poverty`, text: main(step), color: step.colour }] : []),
                        { key: "pp", name: "Rate", text: formatPp(step.pp), color: peopleMode ? "transparent" : step.colour },
                      ]}
                    />,
                  )}
                >
                  {ticks.map((t) => (
                    <span key={t} className={`wf-grid${t === 0 ? " wf-zero" : ""}`} style={{ left: `${pos(t)}%` }} />
                  ))}
                  {/* The step's start, joined to the step before */}
                  {i > 0 && step.kind !== "total" && <span className="wf-join" style={{ left: `${pos(step.start)}%` }} />}
                  <span className="wf-bar" style={{ left: `${left}%`, width: `${width}%`, background: step.colour }} />
                </span>
                <span className="wf-value" role="cell">
                  <span className="wf-main">{main(step)}</span>
                  {peopleMode && <span className="wf-pp">{formatPp(step.pp)}</span>}
                </span>
              </div>
            );
          })}
          <div className="wf-row wf-axis" aria-hidden="true">
            <span className="wf-label" />
            <span className="wf-track">
              {ticks.map((t) => (
                <span key={t} className="wf-tick" style={{ left: `${pos(t)}%` }}>
                  {tickText(t)}
                </span>
              ))}
            </span>
            <span className="wf-value" />
          </div>
          <div className="wf-row wf-caption" aria-hidden="true">
            <span className="wf-label" />
            <span className="wf-track">
              {peopleMode ? `${who[0].toUpperCase()}${who.slice(1)} out of poverty →` : "Fall in the rate (pp) →"}
            </span>
            <span className="wf-value" />
          </div>
          <FloatingTooltip tip={tip} />
        </div>
      </div>
      <div className="chart-legend">
        {zero.length > 0 && (
          <p className="wf-none">
            No effect on poverty: {zero.map((m) => m.name).join(", ")}
            {zeroInfo && (
              <span className="info-icon-wrapper wf-info">
                <button type="button" className="info-icon" aria-label="Why these move no one">
                  i
                </button>
                <span className="info-tooltip" role="tooltip">
                  {zeroInfo}
                </span>
              </span>
            )}
          </p>
        )}
      </div>
      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>
    </LsCard>
  );
}

/**
 * Poverty with the selected measures, as one row of two cards: the change
 * in the poverty rate by year, and which measures move it in the selected
 * year, sharing one poverty choice. People counts use the outlook's
 * populations once it is read.
 */
export function PovertyMeasuresRow({ rows, policies, selectedPolicies, selectedYear }) {
  const { data } = useOutlook();
  const population = outlookPopulation(data);
  const props = { rows, policies, selectedPolicies, selectedYear, population };
  return (
    <div className="charts-grid">
      <SummaryMetricChart metric={SUMMARY_METRICS.poverty} {...props} />
      <MeasuresPovertyCard {...props} />
    </div>
  );
}
