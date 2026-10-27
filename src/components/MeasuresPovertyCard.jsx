// Which measures move poverty: a waterfall of people moved out of (or into)
// poverty in the selected year. Each selected measure's own effect (its own
// run in metrics.csv) is a step in its colour, largest first; where the
// steps do not add up to the package (the combined run), an "interaction"
// step closes the gap; the package total ends it. People are the change in
// the rate times the outlook's population that year (povertyPeople.js);
// without a population the card falls back to percentage points
// throughout. Measures that move no one are one line in More info, not
// empty rows. A run that does not carry the chosen measure (one written
// before the poverty and inequality measures) is never a step of 0: the
// card then shows the headline measure, and says so.
// The poverty choice is shared with the Change in the poverty rate chart
// beside it (usePovertyChoice, ?poverty=).

import { useRef } from "react";
import CountUpText from "./CountUpText";
import MeasureRowLabel from "./MeasureRowLabel";
import LsCard from "./livingStandards/LsCard";
import ControlBar from "./ControlBar";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import SummaryMetricChart, { SUMMARY_METRICS, hasColumn, metricValue, povertyMetric, usePovertyChoice } from "./SummaryMetricChart";
import { useOutlook } from "./livingStandards/useOutlook";
import { formatPp, outlookPopulation, roundPeople } from "../utils/povertyPeople";
import { CHART_COLOURS, fiscalYearTick } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { policyDetailsFor, shortNameOf } from "../utils/policyDetails";
import { legendMembership } from "../utils/legendMembership";
import { wholeSelectionRun } from "../utils/ageImpact";
import "./livingStandards/LivingStandards.css";
import "./MeasuresPovertyCard.css";

// Why the measures with no effect move no one: one sentence, true of every
// such measure, not a reason per measure
const NO_EFFECT_TEXT =
  "They change prices, capital gains or employers' costs, which the income behind the poverty measure leaves out, or move no one across the poverty line this year.";

/**
 * The measures' own changes in the poverty rate (pp) in `year`, for the
 * measures that change incomes that year ({members} lists all, £0 ones
 * muted), and the package's (the combined run) when one run covers the
 * selection. {missing} lists the runs read whose rows do not carry `key`;
 * such a measure's value is null, never 0.
 */
export function measurePovertyRows(rows, catalogue, selectedPolicies, year, key) {
  const rowFor = (id) => (rows ?? []).find((row) => row.reform_id === id && Number(row.year) === year);
  const members = legendMembership(catalogue, selectedPolicies, (id) => Number(rowFor(id)?.people_affected) > 0);
  const measures = members
    .filter((member) => !member.muted)
    .map((member) => ({
      id: member.id,
      name: shortNameOf(member),
      description: member.description,
      value: metricValue(rowFor(member.id), key),
      colour: catalogue.byId.get(member.id)?.color ?? CHART_COLOURS.noChange,
    }));
  const combinedId = catalogue.combinedId;
  const run = wholeSelectionRun(catalogue.displayable, selectedPolicies, combinedId);
  const packageRow = combinedId && run === combinedId ? rowFor(run) : undefined;
  const total = packageRow ? metricValue(packageRow, key) : null;
  const missing = [
    ...measures.filter((measure) => measure.value === null).map((measure) => measure.id),
    ...(packageRow && total === null ? [run] : []),
  ];
  return { members, measures, total, missing };
}

// The headline poverty measure: metrics' own column, which every run carries
const HEADLINE = povertyMetric({ basis: "absolute", housing: "bhc", group: "all" });

/**
 * The card's poverty measure and rows in `year`: the chosen measure where
 * every run the card reads carries it, and some run does; otherwise the
 * headline ({fellBack}), which every run carries; null where not even that
 * is carried. The chart beside it decides on the runs it reads over all
 * years (choiceRows), so the two can differ; the card then says it shows
 * the headline.
 */
export function povertyCardRows(rows, catalogue, selectedPolicies, year, chosen) {
  for (const metric of chosen.key === HEADLINE.key ? [chosen] : [chosen, HEADLINE]) {
    const read = measurePovertyRows(rows, catalogue, selectedPolicies, year, metric.key);
    if (read.missing.length === 0 && hasColumn(rows, metric.key)) return { metric, fellBack: metric !== chosen, ...read };
  }
  return null;
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
    steps.push({ id: "package", name: "All policies together", pp: total, x, start: 0, end: x, colour: null, kind: "total" });
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

export default function MeasuresPovertyCard({ rows, policies, selectedPolicies, selectedYear, population, choiceAbove = false }) {
  const plotRef = useRef(null);
  const catalogue = useMeasureCatalogue();
  const { poverty: chosen, controls } = usePovertyChoice();
  // A file with only the headline column (absolute, before housing costs,
  // all people) offers no choice: the card shows that measure, whatever
  // ?poverty= says, as Change in the poverty rate does, never nothing
  const wide = hasColumn(rows, "child_poverty_rel_ahc_change_pp");
  const poverty = wide ? chosen : { basis: "absolute", housing: "bhc", group: "all" };
  // The headline, said, where a run read here does not carry the choice
  const read = povertyCardRows(rows, catalogue, selectedPolicies, selectedYear, povertyMetric(poverty));
  const metric = read?.metric ?? HEADLINE;
  const { tip, handlers } = useFloatingTooltip(plotRef, `${metric.key}-${selectedYear}`);
  if (!read) return null;

  const year = fiscalYearTick(selectedYear);
  const { members, measures, total } = read;
  // The shown measure's people: everyone's when the card falls back
  const millions = population ? population(selectedYear, metric.group) : null;
  const { steps, zero, peopleMode } = povertyWaterfall(measures, total, millions);
  const who = metric.group === "children" ? "children" : "people";

  // The rate's change in words: "down 0.005 percentage points"
  const rateWords = (pp) =>
    `${pp < 0 ? "down" : pp > 0 ? "up" : "no change,"} ${formatPp(Math.abs(pp)).replace(/^[+−]/, "").replace(/pp$/, " percentage points")}`;
  // "about 4,000 fewer people" (people) or the rate in words (no population)
  const main = (step) => {
    if (!peopleMode) return rateWords(step.pp);
    const n = Math.abs(step.x);
    const way = step.x > 0 ? "fewer" : "more";
    const count = n < 1000 ? "under 1,000" : `about ${roundPeople(n)}`;
    return `${count} ${way} ${who}`;
  };
  // Thousands with commas ("4,000"); the ticks are spaced so they never meet
  const tickText = (t) =>
    peopleMode ? (t === 0 ? "0" : `${t < 0 ? "−" : ""}${thousands.format(Math.abs(t))}`) : t === 0 ? "0" : formatPp(-t).replace("pp", "");

  const ends = steps.flatMap((s) => [s.start, s.end]).concat(0);
  const allTicks = niceTicks(Math.min(...ends), Math.max(...ends));
  const [x0, x1] = [allTicks[0], allTicks.at(-1)];
  // Every round tick (0, 2,000, 4,000, 6,000); on a phone only the ends
  // keep their labels (MeasuresPovertyCard.css)
  const ticks = allTicks;
  // Bars by direction only: fewer in poverty in the gain colour, more in the
  // loss colour, the total a darker shade of the same; each measure's own
  // colour is the dot by its name
  const fillOf = (step) =>
    step.kind === "interaction"
      ? CHART_COLOURS.noChange
      : step.kind === "total"
        ? step.x >= 0
          ? CHART_COLOURS.gainText
          : CHART_COLOURS.lossText
        : step.x >= 0
          ? CHART_COLOURS.gain
          : CHART_COLOURS.loss;
  const pos = (v) => (x1 === x0 ? 50 : ((v - x0) / (x1 - x0)) * 100);

  const measureSteps = steps.filter((s) => s.kind === "measure");
  const top = measureSteps[0];
  const totalStep = steps.find((s) => s.kind === "total");
  const interaction = steps.find((s) => s.kind === "interaction");
  // A plain sentence: no "≈" and no "pp" (the values are in the rows)
  const about = (step) => {
    const n = Math.abs(step.x);
    return n < 1000 ? "under 1,000" : `about ${roundPeople(n)}`;
  };
  // The measure as a sentence's subject: its own sentence form where the
  // catalogue publishes one ("Unfreezing the Plan 2 threshold"), otherwise
  // "Of the measures, <its name>"
  const subjectOf = (step) => {
    const measure = catalogue.byId?.get(step.id);
    const sentence = measure?.sentence ?? policyDetailsFor(measure)?.sentence;
    return sentence ? `${sentence[0].toUpperCase()}${sentence.slice(1)}` : `Of the policies, ${step.name}`;
  };
  const direction = (step) => (step.x > 0 ? "out of" : "into");
  // Mid-sentence, the measure's own sentence form as it is published
  // ("unfreezing the student loan threshold"), else its name
  const inSentence = (step) => {
    const measure = catalogue.byId?.get(step.id);
    return measure?.sentence ?? policyDetailsFor(measure)?.sentence ?? step.name;
  };
  // Led by the package's total, then the measure that moves the most, its
  // direction named only when it differs from the total's
  const summary = top ? (
    peopleMode ? (
      totalStep ? (
        <>
          All the policies together move {about(totalStep)} {who} {direction(totalStep)} poverty; {inSentence(top)} moves the most (
          {about(top)}
          {direction(top) === direction(totalStep) ? "" : ` ${who} ${direction(top)} poverty`}).
        </>
      ) : (
        <>
          {subjectOf(top)} moves {about(top)} {who} {direction(top)} poverty.
        </>
      )
    ) : (
      <>
        {top.name} moves the rate most, by {formatPp(top.pp).replace(/^[+−]/, "").replace(/pp$/, " percentage points")}.
      </>
    )
  ) : (
    <>No policy on its own moves anyone across this line in {year}.</>
  );

  return (
    <LsCard
      title="Which policies move poverty"
      icon="bars"
      className="mp-card"
      period={year}
      // One short line; what the steps measure is in About this chart
      summary={summary}
      download={{
        filename: `${metric.file}-by-measure-${selectedYear}`,
        image: false,
        csv: () =>
          buildChartCsv({
            title: `${metric.title} by policy, ${year}`,
            units: metric.csvUnits,
            columns: [
              { key: "name", label: "Policy" },
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
      // With the choice above the pair (PovertyMeasuresRow), none in the card
      controls={!choiceAbove && wide && <ControlBar name={metric.title} options={controls} />}
      footer={
        <ChartMoreInfo
          members={members}
          year={selectedYear}
          info={{
            how: [
              `Each step is one selected policy modelled on its own, largest first; the package bar is all of them together.`,
              <>
                Measures can reach the same households, so their separate effects need not add up to the package&apos;s
                {interaction ? `: here they miss it by ${main(interaction)}, shown as the interaction step.` : "."}
              </>,
            ],
            // The measures that move no one, and why, here rather than under the chart
            caveats: [
              read.fellBack && (
                <span className="mp-fell-back">
                  Not every policy shown has the chosen poverty line published, so this shows {HEADLINE.phrase}.
                </span>
              ),
              zero.length > 0 && (
                <span className="wf-none">
                  <strong>No effect on poverty:</strong> {zero.map((m) => m.name).join(", ")}. {NO_EFFECT_TEXT}
                </span>
              ),
            ],
            method: { anchor: METHOD_ANCHORS.poverty, label: "How we measure poverty" },
          }}
        />
      }
    >
      <div className="chart-plot">
        <div ref={plotRef} className="wf" role="table" aria-label={`${metric.title} by policy, ${year}`}>
          {steps.map((step, i) => {
            const left = Math.min(pos(step.start), pos(step.end));
            const width = Math.max(Math.abs(pos(step.end) - pos(step.start)), 0.6);
            return (
              <div className={`wf-row wf-${step.kind}`} role="row" key={step.id}>
                <span className="wf-label" role="rowheader">
                  {step.kind === "measure" ? (
                    <MeasureRowLabel measure={catalogue.byId?.get(step.id) ?? { id: step.id, name: step.name, color: step.colour }} name={step.name} colour={step.colour} />
                  ) : (
                    step.name
                  )}
                </span>
                <span
                  className="wf-track has-tooltip"
                  role="cell"
                  tabIndex={0}
                  aria-label={`${main(step)}; poverty rate ${rateWords(step.pp)}`}
                  {...handlers(
                    step.id,
                    <TooltipRows
                      label={`${step.name}, ${year}`}
                      rows={[
                        ...(peopleMode ? [{ key: "people", name: `${who[0].toUpperCase()}${who.slice(1)} in poverty`, text: main(step), color: fillOf(step) }] : []),
                        { key: "pp", name: "Poverty rate", text: rateWords(step.pp), color: peopleMode ? "transparent" : fillOf(step) },
                      ]}
                    />,
                  )}
                >
                  {ticks.map((t) => (
                    <span key={t} className={`wf-grid${t === 0 ? " wf-zero" : ""}`} style={{ left: `${pos(t)}%` }} />
                  ))}
                  {/* The step's start, joined to the step before */}
                  {i > 0 && step.kind !== "total" && <span className="wf-join" style={{ left: `${pos(step.start)}%` }} />}
                  <span className="wf-bar" style={{ left: `${left}%`, width: `${width}%`, background: fillOf(step) }} />
                </span>
                <span className="wf-value" role="cell">
                  <span className="wf-main"><CountUpText text={main(step)} /></span>
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
    <>
      {/* Each card's Options pill holds the poverty measure; the two share
          it (usePovertyChoice, ?poverty=), so choosing in one changes both */}
      {/* Full width, one below the other: which measures first */}
      <div className="charts-stack">
        <MeasuresPovertyCard {...props} />
        <SummaryMetricChart metric={SUMMARY_METRICS.poverty} {...props} />
      </div>
    </>
  );
}

