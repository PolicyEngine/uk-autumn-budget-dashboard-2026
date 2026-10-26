import TitleIcon from "../TitleIcon";
import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import useCountUp from "../../hooks/useCountUp";
import { prefersReducedMotion } from "../../utils/chartMotion";
import { fiscalYearTick } from "../../utils/chartTheme";
import { MINUS, areaName, money, policyRows, signedPercent } from "../../utils/singleYear";
import { STAGE_TIMES } from "../../utils/householdTiming";
import PolicyBars from "./PolicyBars";
import ProgrammeTable from "./ProgrammeTable";
import EarningsChart from "./EarningsChart";
import MarginalRateChart from "./MarginalRateChart";
import "./SingleYear.css";

/** True once `active` has held for `delay` ms (no flash of a loading line). */
function useDelayed(active, delay = 300) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setShown(true), delay);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active, delay]);
  return active && shown;
}

/** What went wrong, in words, with the answers to check when it names them. */
export function SingleYearError({ error, onRetry, title = "Results are not available here." }) {
  const fields = error?.fields ?? [];
  const canRetry = ["timeout", "network", "server"].includes(error?.kind);
  return (
    <div className="household-error single-year-error" role="alert">
      <p className="household-error-title">{title}</p>
      <p>{error?.message ?? "Something stopped the calculation."}</p>
      {fields.length > 0 && (
        <>
          <p>Check these answers:</p>
          <ul>
            {fields.map((field) => (
              <li key={`${field.field}-${field.message}`}>
                <strong>{field.label}</strong>: {field.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {canRetry && onRetry && (
        <button type="button" className="light-pill-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The whole-pound totals the tiles show; the policy rows add up to `change`. */
export function headlineTotals(net) {
  const before = Math.round(net.before);
  const after = Math.round(net.after);
  return { before, after, change: after - before };
}

/**
 * The salaries used, grown to the year; nothing when there are none (a
 * pensioner with no earnings).
 */
export function salaryNote(data, yearLabel) {
  const own = data.salaryUsed ?? 0;
  const partner = data.partnerSalaryUsed ?? 0;
  if (own <= 0 && partner <= 0) return null;
  const partnerText = data.partnerSalaryUsed !== null ? `, and your partner's ${money(partner)}` : "";
  return `Your salary in ${yearLabel}: ${money(own)}${partnerText}, grown from ${data.salaryYear} with the OBR's average earnings forecast.`;
}

/**
 * The note on who counts as a child, only where it matters: a child of 16
 * or over, or one Child Benefit and Universal Credit count differently.
 */
export function showDependantsNote(data) {
  if (!data.dependantsNote) return false;
  return data.dependants.some(
    (child) => child.age >= 16 || child.countsForChildBenefit !== child.countsForUniversalCredit,
  );
}

/**
 * What the figures assume, as short items (label, value, how it was
 * chosen) for one line under the headline. The full explanations are in
 * "About these figures".
 */
export function assumptionItems(data, yearLabel, { renting = false, policies = [] } = {}) {
  const items = [];
  const own = data.salaryUsed ?? 0;
  const partner = data.partnerSalaryUsed ?? 0;
  if (own > 0 || partner > 0) {
    items.push({
      id: "salary",
      label: `Salary in ${yearLabel}`,
      value: data.partnerSalaryUsed !== null ? `${money(own)}, partner ${money(partner)}` : money(own),
      detail: `grown from ${data.salaryYear} with OBR earnings`,
    });
  }
  if (renting && data.area?.brmaDefault && data.area.brma) {
    items.push({ id: "rent-area", label: "Rent area", value: areaName(data.area.brma), detail: "region default" });
  }
  if (data.councilTax && data.councilTax.amount > 0) {
    items.push({
      id: "council-tax",
      label: "Council Tax",
      value: `${money(data.councilTax.amount)} · band ${data.councilTax.band}`,
      detail: data.councilTax.source === "estimated" ? "region average" : "as entered",
    });
  }
  if (showDependantsNote(data)) {
    items.push({
      id: "children",
      label: "Children 16 to 19",
      value: "counted only in school or college",
      detail: null,
    });
  }
  for (const item of data.notModelled) {
    const name = policies.find((policy) => policy.id === item.id)?.name ?? item.name ?? item.id;
    items.push({
      id: `not-${item.id}`,
      label: name,
      value: "not shown",
      detail: item.id === "rail_fares_freeze" ? "national figures only" : "not modelled for one household",
    });
  }
  return items;
}

const changeClass = (value) => (value > 0 ? "is-gain" : value < 0 ? "is-loss" : "is-zero");

/**
 * Whole seconds since `startedAt` (when Calculate was pressed), counted
 * while `active` holds; every panel of one calculation counts from the
 * same moment.
 */
function useElapsedSeconds(active, startedAt) {
  const since = () => (startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);
  const [seconds, setSeconds] = useState(since);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setSeconds(since()), 1000);
    return () => clearInterval(timer);
    // since reads startedAt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startedAt]);
  return active ? seconds : 0;
}

/** The panels' time line: the usual time, or that it is running late. */
export function timeText(seconds, stage = "headline") {
  const times = STAGE_TIMES[stage];
  if (seconds > times.slow) return "Taking longer than usual; still working";
  return times.text;
}

/** "+£88", "−£12" or "No change", from whole pounds. */
const signedPounds = (value) =>
  value === 0 ? "No change" : `${value > 0 ? "+" : MINUS}${money(Math.abs(value))}`;

/**
 * How far the progress bar is after `seconds`: eased towards 90% over the
 * usual time, then holding there until the answer arrives.
 */
export function progressShare(seconds, typical = STAGE_TIMES.headline.typical) {
  const t = Math.min(1, seconds / typical);
  return 0.9 * (1 - (1 - t) ** 2);
}

/**
 * The calculation in progress, shown once it has run 300ms: a spinner, what
 * is happening, the usual time with the seconds so far, and a slim bar that
 * fills over the usual time.
 */
function ProcessingPanel({ seconds }) {
  return (
    <div className="processing-panel" role="status">
      <span className="processing-icon" aria-hidden="true">
        <TitleIcon name="calculator" bare size={22} />
        <span className="processing-spinner" />
      </span>
      <div className="processing-text">
        <p className="processing-title">Calculating your household</p>
        <p className="processing-time">{timeText(seconds)}</p>
        <div className="processing-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progressShare(seconds)})` }} />
        </div>
      </div>
    </div>
  );
}

/** Scroll to a section of the results, under the sticky band. */
function scrollToSection(event, id) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

/**
 * Net income before and after on one scale: two thin bars, the after bar's
 * difference from before marked at its end. They grow in on arrival.
 */
function BeforeAfterBars({ totals }) {
  const top = Math.max(totals.before, totals.after, 1);
  const lower = Math.min(totals.before, totals.after);
  const share = (value) => `${Math.max(0, (value / top) * 100)}%`;
  const [grown, setGrown] = useState(prefersReducedMotion());
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const rows = [
    { key: "before", label: "Before", value: totals.before },
    { key: "after", label: "After", value: totals.after },
  ];
  return (
    <div className={`result-bars ${grown ? "is-grown" : ""}`.trim()}>
      {rows.map((row) => (
        <div key={row.key} className={`result-bar-row is-${row.key}`}>
          <span className="result-bar-label">{row.label}</span>
          <span className="result-bar-track" aria-hidden="true">
            <span className="result-bar-fill" style={{ width: share(row.key === "after" ? lower : row.value) }} />
            {row.key === "after" && totals.change !== 0 && (
              <span
                className="result-bar-diff"
                style={{ left: share(lower), width: share(Math.abs(totals.change)) }}
              />
            )}
          </span>
          <span className="result-bar-value">{money(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The result: one card. Its head names the figure and its year and
 * policies; the body has the change (said nowhere else), large and counted
 * up, with its share as a chip, beside net income before and after as
 * bars; the foot says what it is based on, each note behind an "i". The
 * figure is one element, so it reads (and copies) once.
 */
function ResultCard({ totals, yearLabel, policyCount, items }) {
  const shown = Math.round(useCountUp(totals.change));
  const counting = shown !== totals.change;
  const tone = changeClass(totals.change);
  const share = totals.change === 0 ? null : signedPercent(Math.abs(totals.change), totals.before);
  return (
    <section className={`card result-card ${tone}`} aria-label="Your result">
      <div className="result-card-head">
        <p className="result-card-label">Change in your net income</p>
        <div className="result-card-pills">
          <span className="result-pill">{yearLabel}</span>
          <a
            className="result-pill is-link"
            href="#change-by-policy"
            onClick={(event) => scrollToSection(event, "change-by-policy")}
          >
            {policyCount} {policyCount === 1 ? "policy" : "policies"}
          </a>
        </div>
      </div>
      <div className="result-card-body">
        <div className="result-card-hero">
          <p className="result-figure">
            <span className="result-value" aria-busy={counting || undefined}>
              {signedPounds(counting ? shown : totals.change)}
            </span>
            {totals.change !== 0 && <span className="result-unit"> a year</span>}
          </p>
          {share && (
            <p className={`result-chip ${tone}`}>
              <span aria-hidden="true">{totals.change > 0 ? "▲" : "▼"} </span>
              <span className="visually-hidden">{totals.change > 0 ? "Up " : "Down "}</span>
              {share.replace(/^[+−]/, "")} of net income
            </p>
          )}
        </div>
        <BeforeAfterBars totals={totals} />
      </div>
      {items.length > 0 && (
        <div className="result-card-foot">
          <span className="result-foot-title">Based on</span>
          <dl className="result-foot-items" aria-label="Based on">
            {items.map((item) => (
              <div key={item.id} className="result-foot-item">
                <dt>{item.label}</dt>
                <dd>
                  {item.value}
                  {item.detail && (
                    <span className="info-icon-wrapper">
                      <button type="button" className="info-icon" aria-label={`About ${item.label}: ${item.detail}`}>
                        i
                      </button>
                      <span className="info-tooltip" role="tooltip">
                        {item.detail}
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <a
            className="result-card-more"
            href="#household-breakdown"
            onClick={(event) => scrollToSection(event, "household-breakdown")}
          >
            See the breakdown <span aria-hidden="true">↓</span>
          </a>
        </div>
      )}
    </section>
  );
}

/**
 * The household's headline: the hero card, then what it is based on.
 * Nothing is asked until Calculate: before it, a prompt. The first answer
 * shows a processing panel in place of everything; a later one keeps the
 * last result, dimmed, under a compact panel. When the answers change
 * after a result, the result stays dimmed with a note to press Calculate.
 */
export function SingleYearHeadline({
  result,
  year,
  policies = [],
  noPolicies,
  renting = false,
  submitted = true,
  changed = false,
  policyCount = 0,
  startedAt = null,
}) {
  const { status, data, error, stale, retry } = result;
  // The figures' own year: while a new year loads, the old figures keep
  // their year, never the one just chosen
  const yearLabel = fiscalYearTick(data?.year ?? year);
  const running = submitted && status === "loading";
  const showLoading = useDelayed(running);
  const seconds = useElapsedSeconds(running, startedAt);

  if (noPolicies) {
    return (
      <p className="household-empty" role="status">
        Select at least one policy in the bar above to see your household&apos;s
        net income.
      </p>
    );
  }

  // One state at a time: nothing (before Calculate, or once the answers
  // differ from the result's: the cards above say what to do), the
  // processing panel, or the result
  if (!submitted || changed) return null;

  // Calculating, the first time or again: only the processing panel, never
  // an earlier result
  if (running) {
    return (
      <div className="single-year-headline" aria-busy="true">
        <div className="card processing-card">{showLoading && <ProcessingPanel seconds={seconds} />}</div>
      </div>
    );
  }

  const totals = data && !stale ? headlineTotals(data.net) : null;
  return (
    <div className="single-year-headline">
      {status === "error" && <SingleYearError error={error} onRetry={retry} />}
      {totals && status !== "error" && (
        <div className="single-year-result">
          <ResultCard
            totals={totals}
            yearLabel={yearLabel}
            policyCount={policyCount}
            items={assumptionItems(data, yearLabel, { renting, policies })}
          />
        </div>
      )}
    </div>
  );
}

// What each detail card says while it is calculated
const WAITING_TEXT = {
  policies: "Working out each policy's share",
  earnings: "Calculating net income across salaries",
};

/**
 * A detail card still being calculated: the card at its final height,
 * empty but for one centred message (a small spinner, what is happening,
 * the usual time and a short progress line). Across earnings is one card
 * across the row, so its message is said once. Shown after 300ms, so a
 * quick answer never flashes it.
 */
function PendingSkeleton({ kind, startedAt }) {
  const shown = useDelayed(true);
  // Part of the same wait as the headline: counted from Calculate
  const seconds = useElapsedSeconds(true, startedAt);
  return (
    <div className={`card single-year-card waiting-card is-${kind}`} aria-busy="true">
      {shown && (
        <div className="waiting" role="status">
          <span className="processing-spinner is-small" aria-hidden="true" />
          <p className="waiting-title">{WAITING_TEXT[kind]}</p>
          <p className="waiting-time">{timeText(seconds, "detail")}</p>
          <div className="processing-bar waiting-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${progressShare(seconds, STAGE_TIMES.detail.typical)})` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The household's results below the wizard's card, in Spring Statement
 * 2026's order: the breakdown of net income (with how it is calculated),
 * then this dashboard's extras, change by policy and across earnings (with
 * the marginal tax rate in a closed expander).
 */
export function SingleYearDetails({ result, year, policies, changed = false, startedAt = null }) {
  const { data, detailStatus, detailError, retry } = result;
  // Never an earlier result: nothing while the headline is calculated
  // again, or once the answers differ from the result's
  if (changed || result.stale || result.status === "loading") return null;
  const stale = false;
  if (!data || result.status === "error") return null;
  // The figures' own year (see SingleYearHeadline)
  const yearLabel = fiscalYearTick(data.year ?? year);
  const totals = headlineTotals(data.net);
  const bars = data.byPolicy ? policyRows(data.byPolicy, totals.change, policies) : null;
  const detailFailed = detailStatus === "error";

  // While newer inputs load, every section shows the last figures greyed,
  // under their own year, until the new answer arrives
  return (
    <div className={`single-year-details ${stale ? "is-stale" : ""}`} aria-busy={stale || undefined}>
      {/* The breakdown and the split by policy side by side on a wide
          screen, stacked on a narrow one */}
      <div className="single-year-pair">
        <div className="single-year-pair-col">
          <SectionHeading
            title="Breakdown of household net income"
            subtitle="Market income, taxes and benefits before and after the selected policies. Open a row to see each tax or benefit."
          />
          <section className="report-section" id="household-breakdown">
            {data.programmes ? (
              <ProgrammeTable
                programmes={data.programmes}
                totals={totals}
                bars={bars?.all}
                yearLabel={yearLabel}
                engine={data.engine}
              />
            ) : (
              <div className="card single-year-card">
                <p className="single-year-quiet">The breakdown is not available for this answer.</p>
              </div>
            )}
          </section>
        </div>

        <div className="single-year-pair-col">
          <SectionHeading
            title="Change by policy"
            subtitle="How much each selected policy adds to or takes from your household's net income."
          />
          <section className="report-section" id="change-by-policy">
            {bars ? (
              <PolicyBars
                rows={bars.rows}
                noEffect={bars.noEffect}
                noEffectItems={bars.noEffectItems}
                underAPound={bars.underAPound}
                notes={bars.notes}
                yearLabel={yearLabel}
              />
            ) : detailFailed ? (
              <div className="card single-year-card">
                <SingleYearError error={detailError} onRetry={retry} title="The split by policy is not available." />
              </div>
            ) : (
              <PendingSkeleton kind="policies" startedAt={startedAt} />
            )}
          </section>
        </div>
      </div>

      <SectionHeading
        title="Across earnings"
        subtitle="How your household's net income and marginal tax rate change as your salary varies."
      />
      <section className="report-section">
        {data.sweep ? (
          <div className="charts-grid single-year-chart-pair">
            <EarningsChart sweep={data.sweep} salary={data.salaryUsed} yearLabel={yearLabel} />
            <MarginalRateChart sweep={data.sweep} salary={data.salaryUsed} yearLabel={yearLabel} />
          </div>
        ) : detailFailed ? (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The earnings charts are not available." />
          </div>
        ) : (
          <PendingSkeleton kind="earnings" startedAt={startedAt} />
        )}
      </section>
    </div>
  );
}
