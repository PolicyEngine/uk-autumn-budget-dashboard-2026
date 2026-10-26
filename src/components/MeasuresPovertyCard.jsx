// Which measures move poverty: each selected measure's own change in the
// poverty rate in the selected year (its own run in metrics.csv), sorted by
// size, in the measures' colours, with the package (the combined run) last.
// The poverty choice is the one the Change in the poverty rate chart beside
// it uses (usePovertyChoice, ?poverty=). A measure that changes no
// household's income that year is listed in "More info" with why
// (ChartMoreInfo), as on the other measure charts.

import { useRef } from "react";
import LsCard from "./livingStandards/LsCard";
import PillSelect from "./PillSelect";
import ChartMoreInfo from "./ChartMoreInfo";
import { FloatingTooltip, TooltipRows, useFloatingTooltip } from "./FloatingTooltip";
import SummaryMetricChart, { SUMMARY_METRICS, hasColumn, povertyMetric, usePovertyChoice } from "./SummaryMetricChart";
import { useOutlook } from "./livingStandards/useOutlook";
import { outlookPopulation } from "../utils/povertyPeople";
import { CHART_COLOURS, divergingAxis, fiscalYearTick } from "../utils/chartTheme";
import { CHART_LOGO } from "../utils/chartLogo";
import { buildChartCsv } from "../utils/chartCsv";
import { COMBINED_REFORM_ID, POLICY_COLORS } from "../utils/policyConfig";
import { legendMembership } from "../utils/legendMembership";
import { wholeSelectionRun } from "../utils/ageImpact";
import { peopleInPovertyText } from "../utils/povertyPeople";
import "./livingStandards/LivingStandards.css";
import "./MeasuresPovertyCard.css";

const PACKAGE = "All selected measures";

/** "−0.005pp", "+0.002pp", "0.000pp" */
const pp = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(3)}pp`;
/** A bar's value: "no change" for a measure that moves no one */
const barText = (value) => (value === 0 ? "no change" : pp(value));

/**
 * The bars: [{id, name, value, colour, isPackage}], measures by size, then
 * the package when one run covers the selection (all measures).
 */
export function measurePovertyRows(rows, policies, selectedPolicies, year, key) {
  const rowFor = (id) =>
    (rows ?? []).find((row) => row.reform_id === id && Number(row.year) === year);
  const members = legendMembership(selectedPolicies, (id) => Number(rowFor(id)?.people_affected) > 0);
  const bars = members
    .filter((member) => !member.muted)
    .map((member) => ({
      id: member.id,
      name: member.name,
      value: Number(rowFor(member.id)?.[key]) || 0,
      colour: POLICY_COLORS[member.name],
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const run = wholeSelectionRun(policies, selectedPolicies);
  const total = run === COMBINED_REFORM_ID ? Number(rowFor(run)?.[key]) : NaN;
  if (Number.isFinite(total)) {
    bars.push({ id: run, name: PACKAGE, value: total, colour: CHART_COLOURS.net, isPackage: true });
  }
  return { members, bars };
}

export default function MeasuresPovertyCard({ rows, policies, selectedPolicies, selectedYear, population }) {
  const plotRef = useRef(null);
  const { poverty, controls } = usePovertyChoice();
  const metric = povertyMetric(poverty);
  const { tip, handlers } = useFloatingTooltip(plotRef, `${metric.key}-${selectedYear}`);
  if (!hasColumn(rows, metric.key)) return null;

  const year = fiscalYearTick(selectedYear);
  const { members, bars } = measurePovertyRows(rows, policies, selectedPolicies, selectedYear, metric.key);
  const millions = population ? population(selectedYear, poverty.group) : null;
  const people = (value) => peopleInPovertyText(value, millions, poverty.group);

  const { domain, ticks } = divergingAxis(bars.map((bar) => bar.value).concat(0));
  const [x0, x1] = domain;
  const scale = (value) => (x1 === x0 ? 50 : ((value - x0) / (x1 - x0)) * 100);
  const zero = scale(0);

  const measures = bars.filter((bar) => !bar.isPackage);
  const top = measures[0];
  const total = bars.find((bar) => bar.isPackage);
  const summary =
    top && top.value !== 0 ? (
      <>
        {top.name} moves it most on its own: <strong>{pp(top.value)}</strong>
        {people(top.value) && <>, {people(top.value)}</>}.
        {total && (
          <>
            {" "}
            The package: <strong>{pp(total.value)}</strong>
            {people(total.value) && <>, {people(total.value)}</>}.
          </>
        )}
      </>
    ) : (
      <>None of the selected measures moves anyone across this poverty line on its own in {year}.</>
    );

  const zeroed = measures.filter((bar) => bar.value === 0);
  const tickText = (value) => (value === 0 ? "0" : `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(3)}`);

  return (
    <LsCard
      title="Which measures move poverty"
      icon="bars"
      period={year}
      summary={
        <>
          Each selected measure on its own, and the package: the change in {metric.phrase}, in percentage
          points. {summary}
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
              { key: "value", label: "Change (pp)", decimals: 4 },
            ],
            rows: bars,
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
            Each bar is a measure modelled on its own. Measures can reach the same households, so their
            separate effects need not add up exactly to the package&apos;s.
          </p>
          {zeroed.length > 0 && (
            <p>
              A bar at 0 is a measure that changes incomes in {year} but moves no one across this poverty
              line on its own.
            </p>
          )}
        </ChartMoreInfo>
      }
    >
      <div className="chart-plot">
        <div
          ref={plotRef}
          style={{ position: "relative" }}
          className="ls-bars mp-bars"
          role="table"
          aria-label={`${metric.title} by measure, ${year}`}
        >
          {bars.map((bar) => {
            const end = scale(bar.value);
            const text = barText(bar.value);
            const who = people(bar.value);
            return (
              <div className={`ls-bar-row${bar.isPackage ? " mp-package" : ""}`} role="row" key={bar.id}>
                <span className="ls-bar-label" role="rowheader">
                  {bar.name}
                </span>
                <span
                  className="ls-bar-area has-tooltip"
                  role="cell"
                  tabIndex={0}
                  aria-label={`${text}${who ? `, ${who}` : ""}`}
                  {...handlers(
                    bar.id,
                    <TooltipRows
                      label={`${bar.name}, ${year}`}
                      rows={[
                        { key: "change", name: "Change", text, color: bar.colour },
                        ...(who ? [{ key: "people", name: "People", text: who, color: "transparent" }] : []),
                      ]}
                    />,
                  )}
                >
                  {ticks.map((t) => (
                    <span key={t} className="ls-bar-grid" style={{ left: `${scale(t)}%` }} />
                  ))}
                  <span className="mp-zero" style={{ left: `${zero}%` }} />
                  <span
                    className="mp-bar-fill"
                    style={{
                      left: `${Math.min(zero, end)}%`,
                      width: `${Math.abs(end - zero)}%`,
                      background: bar.colour,
                    }}
                  />
                </span>
                <span className="ls-bar-chip-cell mp-value" role="cell">
                  {text}
                </span>
              </div>
            );
          })}
          <div className="ls-bar-row ls-bar-axis" aria-hidden="true">
            <span className="ls-bar-label" />
            <span className="ls-bar-area">
              {ticks.map((t) => (
                <span key={t} className="ls-bar-tick" style={{ left: `${scale(t)}%` }}>
                  {tickText(t)}
                </span>
              ))}
            </span>
            <span className="ls-bar-chip-cell" />
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
    <div className="charts-grid">
      <SummaryMetricChart metric={SUMMARY_METRICS.poverty} {...props} />
      <MeasuresPovertyCard {...props} />
    </div>
  );
}
