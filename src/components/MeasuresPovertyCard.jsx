// Which measures move poverty: people moved out of (or into) poverty in the
// selected year. Each selected measure's own effect (its own run in
// metrics.csv) is a bar from zero, largest first; then, after a rule, all
// the selected policies together (the combined run), also from zero. No bar
// starts where another ends and nothing is added up or backed out: each row
// reads one published run. (Pavel's review, POV2 to POV5: the old waterfall
// read as if the policies stacked, and its "interaction" step also held the
// Plan 2 baseline difference.) People are the change in
// the rate times the outlook's population that year (povertyPeople.js);
// without a population the card falls back to percentage points
// throughout. Every selected policy has a row: one that moves no one shows
// "No change" and why (noPovertyEffectReason), after the steps. A run that does not carry the chosen measure (one written
// before the poverty and inequality measures) is never a step of 0: the
// card then shows the headline measure, and says so.
// The poverty choice is shared with the Change in the poverty rate chart
// beside it (usePovertyChoice, ?poverty=).

import { useRef } from "react";
import useElementWidth from "../hooks/useElementWidth";
import CountUpText from "./CountUpText";
import MeasureRowLabel from "./MeasureRowLabel";
import LsCard from "./livingStandards/LsCard";
import ControlBar from "./ControlBar";
import ChartMoreInfo from "./ChartMoreInfo";
import NoBreakYear from "./NoBreakYear";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { MethodLink } from "../utils/methodLink";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import SummaryMetricChart, { NOT_PUBLISHED, SUMMARY_METRICS, hasColumn, isWithheld, metricValue, povertyMetric, usePovertyChoice } from "./SummaryMetricChart";
import { useOutlook } from "./livingStandards/useOutlook";
import { formatPp, outlookPopulation, roundPeople } from "../utils/povertyPeople";
import { CHART_COLOURS, MAGNITUDE_RAMPS, fiscalYearTick, fitTicks, magnitudeColours } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { policyDetailsFor, shortNameOf } from "../utils/policyDetails";
import { legendMembership, noPovertyEffectReason } from "../utils/legendMembership";
import { wholeSelectionRun } from "../utils/ageImpact";
import "./livingStandards/LivingStandards.css";
import "./MeasuresPovertyCard.css";

/**
 * The measures' own changes in the poverty rate (pp) in `year`, for the
 * measures that change incomes that year ({members} lists all, £0 ones
 * muted), and the package's (the combined run) when one run covers the
 * selection. {idle} are the selected measures that change no income that
 * year (muted), each a "No change" row. {missing} lists the runs read whose
 * rows do not carry `key`; such a measure's value is null, never 0. A
 * figure the floor of survey households withheld (isWithheld) is null with
 * {withheld} true, and is not missing; {totalWithheld} says the same of the
 * package's. A withheld people affected still changes incomes: it rests on
 * a household or two, so the measure is never muted for it.
 */
export function measurePovertyRows(rows, catalogue, selectedPolicies, year, key) {
  const rowFor = (id) => (rows ?? []).find((row) => row.reform_id === id && Number(row.year) === year);
  const affects = (id) => isWithheld(rowFor(id), "people_affected") || Number(rowFor(id)?.people_affected) > 0;
  const members = legendMembership(catalogue, selectedPolicies, affects);
  const measures = members
    .filter((member) => !member.muted)
    .map((member) => ({
      id: member.id,
      name: shortNameOf(member),
      description: member.description,
      value: metricValue(rowFor(member.id), key),
      withheld: isWithheld(rowFor(member.id), key),
      colour: catalogue.byId.get(member.id)?.color ?? CHART_COLOURS.noChange,
    }));
  const idle = members
    .filter((member) => member.muted)
    .map((member) => ({ id: member.id, name: shortNameOf(member), value: 0, colour: catalogue.byId.get(member.id)?.color ?? CHART_COLOURS.noChange }));
  const combinedId = catalogue.combinedId;
  const run = wholeSelectionRun(catalogue.displayable, selectedPolicies, combinedId);
  const packageRow = combinedId && run === combinedId ? rowFor(run) : undefined;
  const total = packageRow ? metricValue(packageRow, key) : null;
  const totalWithheld = isWithheld(packageRow, key);
  const missing = [
    ...measures.filter((measure) => measure.value === null && !measure.withheld).map((measure) => measure.id),
    ...(packageRow && total === null && !totalWithheld ? [run] : []),
  ];
  return { members, measures, idle, total, totalWithheld, missing };
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
 * The chart's rows from the measures' changes (pp): x is people moved out
 * of poverty (or, with no population, −pp), so a fall in poverty points
 * right. Each measure's bar from 0, by size, then a "No change" row (no
 * bar) for each measure that moves no one (a value of exactly 0, or `idle`:
 * no income changed that year), then all the selected policies together
 * from 0. A small non-zero change is a bar, never "No change". Nothing is
 * summed: no gap or interaction row. A measure the floor of survey
 * households withheld ({withheld}) is a "withheld" row with no bar, said to
 * be not published. With `totalWithheld`, the package is such a row.
 * Returns { steps, zero, peopleMode }; each step is
 * { id, name, pp, x, start, end, colour, kind: "measure" | "none" | "withheld" | "total" }.
 */
export function povertyWaterfall(measures, total, millions, idle = [], totalWithheld = false) {
  const peopleMode = Boolean(millions);
  const toX = (pp) => (peopleMode ? -(pp / 100) * millions * 1e6 : -pp);
  const withheld = measures.filter((m) => m.withheld);
  const shown = measures.filter((m) => !m.withheld);
  const zero = [...shown.filter((m) => m.value === 0), ...idle];
  const moving = shown.filter((m) => m.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const steps = moving.map((m) => {
    const x = toX(m.value);
    return { id: m.id, name: m.name, pp: m.value, x, start: 0, end: x, colour: m.colour, kind: "measure" };
  });
  // At 0 to 0, so a row with no bar never widens the axis
  for (const m of zero) steps.push({ id: m.id, name: m.name, pp: 0, x: 0, start: 0, end: 0, colour: m.colour, kind: "none" });
  for (const m of withheld) steps.push({ id: m.id, name: m.name, pp: null, x: 0, start: 0, end: 0, colour: m.colour, kind: "withheld" });
  if (totalWithheld) {
    steps.push({ id: "package", name: TOGETHER, pp: null, x: 0, start: 0, end: 0, colour: null, kind: "withheld" });
  } else if (total !== null) {
    const x = toX(total);
    steps.push({ id: "package", name: TOGETHER, pp: total, x, start: 0, end: x, colour: null, kind: "total" });
  }
  return { steps, zero, peopleMode };
}

const thousands = new Intl.NumberFormat("en-GB");

/** The last row's name: every selected policy at once, from its own run. */
export const TOGETHER = "All selected policies together";

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

/**
 * The track's tick labels: the round ticks whose labels fit its measured
 * width (chartTheme.fitTicks: 0 always, fewer on a phone), the first
 * starting and the last ending at its tick, inside the track. Its own
 * component, so the track is measured from when it mounts.
 */
function WfTicks({ ticks, domain, format }) {
  const [ref, width] = useElementWidth();
  const [x0, x1] = domain;
  const shown = fitTicks(ticks, domain, width, format, { inside: true });
  return (
    <span className="wf-track" ref={ref}>
      {shown.map((t) => (
        <span
          key={t}
          className={`wf-tick${t === x0 ? " is-start" : t === x1 ? " is-end" : ""}`}
          style={{ left: `${x1 === x0 ? 50 : ((t - x0) / (x1 - x0)) * 100}%` }}
        >
          {format(t)}
        </span>
      ))}
    </span>
  );
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
  const { measures, idle, total, totalWithheld } = read;
  // The shown measure's people: everyone's when the card falls back
  const millions = population ? population(selectedYear, metric.group) : null;
  const { steps, peopleMode } = povertyWaterfall(measures, total, millions, idle, totalWithheld);
  const who = metric.group === "children" ? "children" : "people";

  // The rate's change in words: "down 0.005 percentage points"
  const rateWords = (pp) =>
    `${pp < 0 ? "down" : pp > 0 ? "up" : "no change,"} ${formatPp(Math.abs(pp)).replace(/^[+−]/, "").replace(/pp$/, " percentage points")}`;
  // "about 4,000 fewer people" (people) or the rate in words (no population)
  const main = (step) => {
    if (step.kind === "none") return "No change";
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
  // A sliver the other side of 0 (under 2% of the longest bar) does not
  // open a whole tick step there: its bar still shows at 0
  const [lo, hi] = [Math.min(...ends), Math.max(...ends)];
  const sliver = (v, other) => Math.abs(v) < 0.02 * Math.abs(other);
  const allTicks = niceTicks(sliver(lo, hi) ? 0 : lo, sliver(hi, lo) ? 0 : hi);
  const [x0, x1] = [allTicks[0], allTicks.at(-1)];
  // Every round tick has a gridline (0, 2,000, 4,000, 6,000); WfTicks
  // labels those that fit the track
  const ticks = allTicks;
  // Bars by direction and size: fewer in poverty in the gain ramp, more in
  // the loss ramp, the largest step the darkest and smaller ones lighter
  // (magnitudeColours); the total the darkest step of its direction. Each
  // measure's own colour is the dot by its name
  const shades = new Map();
  const measureShades = magnitudeColours(steps.filter((s) => s.kind === "measure").map((s) => s.x));
  steps.filter((s) => s.kind === "measure").forEach((s, k) => shades.set(s.id, measureShades[k]));
  const fillOf = (step) =>
    step.kind === "total"
        ? MAGNITUDE_RAMPS[step.x >= 0 ? "gain" : "loss"][0]
        : shades.get(step.id) ?? CHART_COLOURS.noChange;
  const pos = (v) => (x1 === x0 ? 50 : ((v - x0) / (x1 - x0)) * 100);

  // Why a "No change" row moves no one: "changes prices, not incomes"
  const reasonOf = (step) => noPovertyEffectReason(catalogue.byId?.get(step.id) ?? { id: step.id, name: step.name }, selectedYear);
  const measureSteps = steps.filter((s) => s.kind === "measure");
  const top = measureSteps[0];
  const totalStep = steps.find((s) => s.kind === "total");
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
  // Led by all the policies together, then the policy that moves the most
  // on its own: never read as a share of the total (POV2)
  const summary = top ? (
    peopleMode ? (
      totalStep ? (
        <>
          The selected policies together move {about(totalStep)} {who} {direction(totalStep)} poverty. On its own,{" "}
          {inSentence(top)} moves the most ({about(top)}
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
  ) : steps.some((step) => step.kind === "withheld") ? (
    // Withheld is never "moves no one": too few survey households to say
    <>{NOT_PUBLISHED} for {year}: too few survey households are behind these figures.</>
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
        csv: () =>
          buildChartCsv({
            title: `${metric.title} by policy, ${year}`,
            units: metric.csvUnits,
            columns: [
              { key: "name", label: "Policy" },
              { key: "pp", label: "Change (pp)", decimals: 4 },
              ...(peopleMode ? [{ key: "people", label: `Change in ${who} in poverty`, decimals: 0 }] : []),
            ],
            // A withheld figure says so, never 0
            rows: steps.map((s) => ({
              name: s.name,
              pp: s.kind === "withheld" ? NOT_PUBLISHED : s.pp,
              people: s.kind === "withheld" ? NOT_PUBLISHED : s.x === 0 ? 0 : -s.x,
            })),
          }),
      }}
      // With the choice above the pair (PovertyMeasuresRow), none in the card
      controls={!choiceAbove && wide && <ControlBar name={metric.title} options={controls} />}
      footer={
        // The policies that move no one have their rows, each with why: no
        // list of them here
        <ChartMoreInfo
          info={{
            how: [
              // The policy's own effect is said once, in the sentence above
              // (round 3); why the bars need not add up, linked (critic W2)
              <>
                The last bar is all the selected policies together, from its own run, so the bars need not add up to it.{" "}
                <MethodLink anchor={METHOD_ANCHORS.limitations}>Policies added up</MethodLink> explains why.
              </>,
            ],
            caveats: [
              read.fellBack && (
                <span className="mp-fell-back">
                  Not every policy shown has the chosen poverty line published, so this shows {HEADLINE.phrase}.
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
              <div className={`wf-row wf-${step.kind} row-band${i % 2 === 0 ? " is-banded" : ""}`} role="row" key={step.id}>
                <span className="wf-label" role="rowheader">
                  {step.kind === "measure" || step.kind === "none" || (step.kind === "withheld" && step.id !== "package") ? (
                    <MeasureRowLabel measure={catalogue.byId?.get(step.id) ?? { id: step.id, name: step.name, color: step.colour }} name={step.name} colour={step.colour} />
                  ) : (
                    step.name
                  )}
                </span>
                {step.kind === "none" || step.kind === "withheld" ? (
                  // No bar: the gridlines only, so "No change" never reads as
                  // a tiny step, nor a withheld figure as any change
                  <span
                    className="wf-track"
                    role="cell"
                    aria-label={step.kind === "withheld" ? `${NOT_PUBLISHED}: too few survey households` : `No change: ${reasonOf(step)}`}
                  >
                    {ticks.map((t) => (
                      <span key={t} className={`wf-grid${t === 0 ? " wf-zero" : ""}`} style={{ left: `${pos(t)}%` }} />
                    ))}
                  </span>
                ) : (
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
                  <span className="wf-bar" style={{ left: `${left}%`, width: `${width}%`, background: fillOf(step) }} />
                </span>
                )}
                <span className="wf-value" role="cell">
                  {step.kind === "withheld" ? (
                    <>
                      <span className="wf-main row-band-value">{NOT_PUBLISHED}</span>
                      <span className="wf-reason">Too few survey households</span>
                    </>
                  ) : step.kind === "none" ? (
                    <>
                      <span className="wf-main row-band-value">No change</span>
                      <span className="wf-reason"><NoBreakYear text={reasonOf(step)} /></span>
                    </>
                  ) : (
                    <span className="wf-main row-band-value"><CountUpText text={main(step)} /></span>
                  )}
                </span>
              </div>
            );
          })}
          <div className="wf-row wf-axis" aria-hidden="true">
            <span className="wf-label" />
            <WfTicks ticks={ticks} domain={[x0, x1]} format={tickText} />
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

