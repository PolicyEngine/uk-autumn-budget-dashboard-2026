import TitleIcon from "../TitleIcon";
import { useEffect, useMemo, useState } from "react";
import SectionHeading from "../SectionHeading";
import Disclosure from "../Disclosure";
import { InfoTip } from "../Tip";
import { CircleSlash, Info, ListChecks, TriangleAlert } from "lucide-react";
import "../InfoSections.css";
import useCountUp from "../../hooks/useCountUp";
import { prefersReducedMotion } from "../../utils/chartMotion";
import { fiscalYearTick, useNarrowViewport } from "../../utils/chartTheme";
import { MINUS, areaName, money, policyRows, signedPercent, sweepPoints } from "../../utils/singleYear";
import { STAGE_TIMES, STILL_WORKING_SECONDS, STILL_WORKING_TEXT } from "../../utils/householdTiming";
import { isStartingUp } from "../../utils/householdImpactApi";
import NetIncomeWaterfall, { waterfallScaleStart } from "./NetIncomeWaterfall";
import { layerRows, layersInUse } from "./netIncomeParts";
import { partsInUse } from "./marginalRateParts";
import { componentsInUse, sharedSweepChips } from "./sweepComponents";
import SeriesToggle from "../SeriesToggle";
import ProgrammeTable from "./ProgrammeTable";
import EarningsChart from "./EarningsChart";
import IncomePositionChart, { ResultTiles } from "./IncomePositionChart";
import MarginalRateChart from "./MarginalRateChart";
import "./SingleYear.css";
import { scrollBelowBars } from "../../utils/pageScroll";
import { policyDetailsFor } from "../../utils/policyDetails";
import { resultPolicies } from "../../utils/calculatorOnlyMeasures";

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

// What the page says while the calculator is starting up (a cold service
// answered with nothing, a 5xx or not in time, and is being asked again),
// and once it has asked again and still had no answer
export const STARTING_UP_TITLE = "The calculator is starting up";
export const STARTING_UP_TEXT = "This can take up to a minute. Your result will appear here.";
export const STILL_STARTING_TITLE = "The calculator is still starting up.";
export const STILL_STARTING_TEXT = "This can take up to a minute after a quiet spell. Please try again shortly.";

const ERROR_TITLE = "Results are not available here.";

/** What went wrong, in words, with the answers to check when it names them. */
export function SingleYearError({ error, onRetry, title = ERROR_TITLE }) {
  const fields = error?.fields ?? [];
  const canRetry = ["timeout", "network", "server"].includes(error?.kind);
  // A service that never answered after the page's own retries: calm words
  // and Try again, not the technical cause; a part's own title is kept
  const starting = isStartingUp(error);
  return (
    <div className="household-error single-year-error" role="alert">
      <p className="household-error-title">{starting && title === ERROR_TITLE ? STILL_STARTING_TITLE : title}</p>
      <p>{starting ? STILL_STARTING_TEXT : (error?.message ?? "Something stopped the calculation.")}</p>
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

/**
 * The whole-pound totals the tiles show; the policy rows add up to
 * `change`. The change is the rounded change itself (as the example cards
 * and the strip show it), never the difference of two rounded totals,
 * which can be £1 out (£108.38 is +£108, not 70,159 − 70,050 = +£109);
 * after is before plus it, so the waterfall adds up.
 */
export function headlineTotals(net) {
  const before = Math.round(net.before);
  const change = Math.round(Number.isFinite(net.change) ? net.change : net.after - net.before);
  return { before, after: before + change, change };
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
export function assumptionItems(data, yearLabel, { renting = false, policies = [], spending = null, salarySource = null, spendingSource = null } = {}) {
  const items = [];
  const own = data.salaryUsed ?? 0;
  const partner = data.partnerSalaryUsed ?? 0;
  if (own > 0 || partner > 0) {
    items.push({
      id: "salary",
      label: `Salary in ${yearLabel}`,
      value: data.partnerSalaryUsed !== null ? `${money(own)}, partner ${money(partner)}` : money(own),
      detail: salarySource
        ? `${salarySource}; grown from ${data.salaryYear} with OBR earnings`
        : `grown from ${data.salaryYear} with OBR earnings`,
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
  // The spending the fuel and electricity measures act on: prefilled with
  // the average household's, so a default answer's gain comes from it
  const fuel = (spending?.petrol ?? 0) + (spending?.diesel ?? 0);
  const electricity = spending?.electricity ?? 0;
  if (fuel > 0 || electricity > 0) {
    const parts = [];
    if (fuel > 0) parts.push(`fuel ${money(fuel)}`);
    if (electricity > 0) parts.push(`electricity ${money(electricity)}`);
    // Assumed, not entered: the prefilled average, or an example's figure
    const assumed = spending?.assumed ?? null;
    items.push({
      id: "spending",
      label:
        assumed === "average"
          ? "Spending a year (assumed, ONS average)"
          : assumed === "example"
            ? "Spending a year (assumed)"
            : "Spending a year",
      value: parts.join(", "),
      // An example's own figures say where they come from
      detail:
        assumed === "example" && spendingSource
          ? `${spendingSource}. Fuel and electricity policies scale with what you spend; change these in the Spending step to match your household.`
          : assumed
            ? "Fuel and electricity policies scale with what you spend; change these in the Spending step to match your household."
            : "petrol, diesel and electricity, from the Spending step",
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
      detail: "not modelled for one household",
    });
  }
  return items;
}

// The measures whose gain scales with the fuel and electricity a household
// buys
export const SPENDING_MEASURES = ["fuel_duty_rise_deferral", "road_fuel_vat_cut", "domestic_electricity_zero_vat"];

/**
 * Whether most of a change comes from the spending-driven measures: their
 * part has the change's sign and is more than half of it.
 */
export function mostlyFromSpending(byPolicy, change) {
  if (!byPolicy || !change) return false;
  const part = byPolicy.measures
    .filter((row) => SPENDING_MEASURES.includes(row.id))
    .reduce((sum, row) => sum + row.change, 0);
  return part / change > 0.5;
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
  if (seconds > STILL_WORKING_SECONDS) return STILL_WORKING_TEXT;
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
function ProcessingPanel({ seconds, startingUp = false }) {
  return (
    <div className="processing-panel" role="status" data-starting-up={startingUp || undefined}>
      <span className="processing-icon" aria-hidden="true">
        <TitleIcon name="calculator" bare size={22} />
        <span className="processing-spinner" />
      </span>
      <div className="processing-text">
        <p className="processing-title">{startingUp ? STARTING_UP_TITLE : "Calculating your household"}</p>
        <p className="processing-time">{startingUp ? STARTING_UP_TEXT : timeText(seconds)}</p>
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
  scrollBelowBars(target, { behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/**
 * What the waterfall's steps leave out: policies worth under £1 and notes
 * on a policy's figure (an employer cost's says why it is £0). The
 * policies with no effect are one line in the waterfall itself.
 */
/** An employer cost's note, without the API's leading label, as a sentence. */
const shortReason = (text) => {
  const rest = (text ?? "").replace(/^No household effect \(employer cost\):\s*/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/**
 * The result card's "About this result", in the charts' "About this chart"
 * style (InfoSections): two columns with matching headings, "Based on"
 * (each fact with its tip) and "No effect on you" (a chip each; an
 * employer cost's reason in its tip); then Notes (any measure's own note,
 * one under £1 a year); then Caveats, on assumed spending when most of the
 * change comes from it. Each fact once.
 */
function AboutResult({ items, caution, bars, totals }) {
  const noEffect = bars?.noEffectItems ?? [];
  // Employer costs are said with their chip under "No effect on you"
  const notes = (bars?.notes ?? []).filter((note) => note.kind !== "employer_cost");
  const under = bars?.underAPound ?? [];
  // The waterfall's bars start above £0 (its axis tick shows where): why
  const scaleStart = totals ? waterfallScaleStart(totals, bars ? bars.rows : null) : 0;
  const parts = [
    items.length > 0 && "Based on",
    noEffect.length > 0 && "No effect on you",
    (notes.length > 0 || under.length > 0 || scaleStart > 0) && "Notes",
    caution && "Caveats",
  ].filter(Boolean);
  if (!caution && parts.length === 0) return null;
  const extra = [
    ...(scaleStart > 0 ? [`The bars start at ${money(scaleStart)} so the changes are visible.`] : []),
    ...(under.length > 0 ? [`Less than £1 a year: ${under.join(", ")}.`] : []),
    ...notes.map((note) => (
      <span key={note.id} data-note={note.kind}>
        <strong>{note.name}</strong>: {note.text}
      </span>
    )),
  ];
  return (
    <Disclosure inCard title="About this result" preview={parts.join(" · ")} className="result-card-about">
      <div className="info-sections result-about">
        <div className="result-about-columns">
          {items.length > 0 && (
            <section className="info-section result-card-basis">
              <h4 className="info-heading">
                <ListChecks aria-hidden="true" strokeWidth={1.75} />
                Based on
              </h4>
              <dl className="result-foot-items" aria-label="Based on">
                {items.map((item) => (
                  <div key={item.id} className="result-foot-item">
                    <dt>{item.label}</dt>
                    <dd>
                      {item.value}
                      {item.detail && <InfoTip content={item.detail} label={`About ${item.label}: ${item.detail}`} />}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {noEffect.length > 0 && (
            <section className="info-section result-card-no-effect">
              <h4 className="info-heading">
                <CircleSlash aria-hidden="true" strokeWidth={1.75} />
                No effect on you
              </h4>
              <ul className="result-no-effect-chips">
                {noEffect.map((item) => (
                  // The why tip is the chip's one tip: the native title only without it
                  <li key={item.id} className="result-no-effect-chip" title={item.reason ? undefined : item.name}>
                    {item.label ?? item.name}
                    {item.reason && <InfoTip content={shortReason(item.reason)} label={`Why ${item.name} has no effect`} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {extra.length > 0 && (
          <section className="info-section result-card-notes">
            <h4 className="info-heading">
              <Info aria-hidden="true" strokeWidth={1.75} />
              Notes
            </h4>
            <div className="info-body">
              {extra.length > 1 ? (
                <ul className="info-list">
                  {extra.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="info-text">{extra[0]}</div>
              )}
            </div>
          </section>
        )}
        {caution && (
          <section className="info-section">
            <h4 className="info-heading">
              <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
              Caveats
            </h4>
            <div className="info-body">
              <div className="info-text info-caveats result-about-caution">
                Most of the change comes from assumed fuel and electricity spending.
              </div>
            </div>
          </section>
        )}
      </div>
    </Disclosure>
  );
}

/**
 * The two "Across earnings" cards, in step, side by side (stacked on a
 * phone): one Before | After | Change choice, the same "Show:" chips under
 * each card's plot for the components they share (one state here, so a
 * chip switches a component on both cards and both keys, and hovering one
 * brings it forward on both), and the salary hovered on one marked on the
 * other.
 */
export function AcrossEarnings({ sweep, salary, yearLabel }) {
  const narrow = useNarrowViewport();
  const [view, setView] = useState("after");
  const [hidden, setHidden] = useState([]);
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  // "N more with no effect for you", open or not
  const [expanded, setExpanded] = useState(false);
  // Each card's parts in use (as each chart draws them), and the
  // components that apply on either card
  const { netInUse, rateInUse, union } = useMemo(() => {
    const points = sweepPoints(sweep);
    const net = sweep.netParts
      ? new Set(layersInUse([...layerRows(points, sweep.netParts, "before"), ...layerRows(points, sweep.netParts, "after")]).map((layer) => layer.key))
      : new Set();
    const rate = sweep.parts ? new Set(partsInUse([...sweep.parts.before, ...sweep.parts.after]).map((part) => part.name)) : new Set();
    return { netInUse: net, rateInUse: rate, union: componentsInUse(net, rate) };
  }, [sweep]);
  // One control only when both cards draw their parts; else each its own key
  const shared = Boolean(sweep.netParts && sweep.parts);
  const chips = useMemo(() => sharedSweepChips(netInUse, rateInUse), [netInUse, rateInUse]);
  // The one key both cards draw under their plots: the same chips, the
  // same state; a card adds only its own non-chip items (`extras`)
  const legend = shared
    ? (extras = []) => (
        <SeriesToggle
          lead="Show:"
          label="Components"
          series={chips}
          shown={chips.filter((chip) => !chip.disabled && !hidden.includes(chip.key)).map((chip) => chip.key)}
          onChange={(next) => {
            const mine = chips.filter((chip) => !chip.disabled).map((chip) => chip.key);
            setHidden(mine.filter((key) => !next.includes(key)));
          }}
          onHover={setFocus}
          collapseDisabled
          expanded={expanded}
          onExpandedChange={setExpanded}
          noEffectOn="either chart"
          narrow={narrow}
          extras={extras}
        />
      )
    : null;
  const sync = { view, setView, hidden, setHidden, hover, setHover, expanded, setExpanded, union, focus, setFocus: shared ? setFocus : undefined, legend };
  // An answer without the parts (a calculation server deployed before they
  // were added) draws the totals alone: said here, never silently
  const missing = [!sweep.netParts && "net income", !sweep.parts && "the marginal tax rate"].filter(Boolean);
  return (
    <>
      {missing.length > 0 && (
        <p className="single-year-quiet across-earnings-no-parts" role="note">
          The calculation server did not send the breakdown of {missing.join(" or ")} by tax and benefit, so{" "}
          {missing.length === 2 ? "both charts show" : "that chart shows"} the total only.
        </p>
      )}
      <div className="charts-grid single-year-chart-pair">
        <EarningsChart sweep={sweep} salary={salary} yearLabel={yearLabel} sync={sync} />
        <MarginalRateChart sweep={sweep} salary={salary} yearLabel={yearLabel} sync={sync} />
      </div>
    </>
  );
}

/**
 * The result: one card. Its head names the figure and its year and
 * policies; the body has the change (said nowhere else), large and counted
 * up, with its share as a chip, beside the waterfall from net income
 * before, through each policy's change, to net income after (each
 * policy's change is said there only); under the figure, what it is
 * based on, each note behind an "i". The figure is one element, so it
 * reads (and copies) once.
 */
function ResultCard({ totals, yearLabel, requestPolicies = [], items, caution = false, bars = null, splitFailed = false, requestHousehold = null, year, selected = [], catalogue = [] }) {
  const shown = Math.round(useCountUp(totals.change, { fromZero: true }));
  const counting = shown !== totals.change;
  return (
    <section className={`card result-card ${changeClass(totals.change)}`} aria-label="Your result">
      {/* The three tiles on top, then the waterfall from net income
          before through each policy with an effect to after, and About
          this result. Each fact once */}
      <ResultTiles
        totals={totals}
        changeValue={
          <span className="result-change-value" aria-busy={counting || undefined}>
            {signedPounds(counting ? shown : totals.change)}
          </span>
        }
        changeNote={
          <>
            {`In ${yearLabel}, with `}
            <a className="result-policies-link" href="#change-by-policy" onClick={(event) => scrollToSection(event, "change-by-policy")}>
              {resultPolicies(requestPolicies).text}
            </a>
          </>
        }
        household={requestHousehold}
        year={year}
        policies={selected}
      />
      <div className="result-card-body">
        <NetIncomeWaterfall
          totals={totals}
          steps={bars ? bars.rows : null}
          yearLabel={yearLabel}
          splitFailed={splitFailed}
          // A measure's type from the catalogue's measures (objects), as the
          // table's VAT row reads it: `selected` is the selected ids only, so
          // looking measures up there found none and the fuel duty note never
          // showed (chart and table audit, 28 October)
          typeOf={(id) => policyDetailsFor(catalogue.find((policy) => policy.id === id))?.type ?? null}
        />
      </div>
      <AboutResult items={items} caution={caution} bars={bars} totals={totals} />
    </section>
  );
}

/**
 * The household's headline: the hero card, with what it is based on.
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
  spending = null,
  submitted = true,
  changed = false,
  requestPolicies = [],
  startedAt = null,
  salarySource = null,
  spendingSource = null,
  requestHousehold = null,
  selected = [],
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
        <div className="card processing-card">
          {(showLoading || result.startingUp) && <ProcessingPanel seconds={seconds} startingUp={Boolean(result.startingUp)} />}
        </div>
      </div>
    );
  }

  const totals = data && !stale ? headlineTotals(data.net) : null;
  return (
    <div className="single-year-headline">
      {status === "error" && <SingleYearError error={error} onRetry={retry} />}
      {totals && status !== "error" && (
        <div className="single-year-result">
          {/* The section's heading above the result card; Where you sit
              follows it in the details */}
          <SectionHeading
            icon="wallet"
            id="your-result"
            title={`Your result, ${yearLabel}`}
            subtitle="How the selected policies change your net income, policy by policy."
          />
          <ResultCard
            totals={totals}
            yearLabel={yearLabel}
            requestPolicies={requestPolicies}
            items={assumptionItems(data, yearLabel, { renting, policies, spending, salarySource, spendingSource })}
            caution={Boolean(spending?.assumed) && mostlyFromSpending(data.byPolicy, totals.change)}
            requestHousehold={requestHousehold}
            year={data.year ?? year}
            selected={selected}
            catalogue={policies}
            bars={data.byPolicy ? policyRows(data.byPolicy, totals.change, policies, data.year ?? year) : null}
            splitFailed={!data.byPolicy && result.detailStatus === "error"}
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
function PendingSkeleton({ kind, startedAt, startingUp = false }) {
  const shown = useDelayed(true);
  // Part of the same wait as the headline: counted from Calculate
  const seconds = useElapsedSeconds(true, startedAt);
  return (
    <div className={`card single-year-card waiting-card is-${kind}`} aria-busy="true">
      {(shown || startingUp) && (
        <div className="waiting" role="status" data-starting-up={startingUp || undefined}>
          <span className="processing-spinner is-small" aria-hidden="true" />
          <p className="waiting-title">{startingUp ? STARTING_UP_TITLE : WAITING_TEXT[kind]}</p>
          <p className="waiting-time">{startingUp ? STARTING_UP_TEXT : timeText(seconds, "detail")}</p>
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
export function SingleYearDetails({ result, year, policies, household = null, selected = null, you = null, changed = false, startedAt = null }) {
  const { data, detailStatus, detailError, retry } = result;
  // Never an earlier result: nothing while the headline is calculated
  // again, or once the answers differ from the result's
  if (changed || result.stale || result.status === "loading") return null;
  const stale = false;
  if (!data || result.status === "error") return null;
  // The figures' own year (see SingleYearHeadline)
  const yearLabel = fiscalYearTick(data.year ?? year);
  const totals = headlineTotals(data.net);
  const bars = data.byPolicy ? policyRows(data.byPolicy, totals.change, policies, data.year ?? year) : null;
  const detailFailed = detailStatus === "error";

  // While newer inputs load, every section shows the last figures greyed,
  // under their own year, until the new answer arrives
  return (
    <div className={`single-year-details ${stale ? "is-stale" : ""}`} aria-busy={stale || undefined}>
      {household && (
        // Its own heading, only when the distribution is there: when it is
        // not, the Your place tile above says so in one line
        <IncomePositionChart
          net={data.net}
          household={household}
          year={data.year ?? year}
          policies={selected ?? []}
          yearLabel={yearLabel}
          you={you}
          policySteps={bars?.rows ?? null}
        />
      )}

      {/* No section heading: the card's own title names the table and its
          year (one home for it) */}
      <section className="report-section" id="household-breakdown">
        {data.programmes ? (
          <ProgrammeTable
            programmes={data.programmes}
            totals={totals}
            bars={bars?.all}
            split={bars}
            splitStatus={bars ? "ready" : detailFailed ? "error" : "loading"}
            policies={policies}
            household={household}
            salaryUsed={data.salaryUsed}
            year={data.year ?? year}
            yearLabel={yearLabel}
            engine={data.engine}
          />
        ) : (
          <div className="card single-year-card">
            <p className="single-year-quiet">The breakdown is not available for this answer.</p>
          </div>
        )}
        {detailFailed && !bars && (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The split by policy is not available." />
          </div>
        )}
      </section>

      <SectionHeading
        icon="briefcase"
        title="Across earnings"
        subtitle="How your net income, its change and your marginal tax rate vary with earnings."
      />
      <section className="report-section">
        {data.sweep ? (
          // Net income (with its Net income / Change switch) beside the
          // marginal rate, a pair of cards whose rows line up; stacked on a phone
          <AcrossEarnings sweep={data.sweep} salary={data.salaryUsed} yearLabel={yearLabel} />
        ) : detailFailed ? (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The earnings charts are not available." />
          </div>
        ) : (
          <PendingSkeleton kind="earnings" startedAt={startedAt} startingUp={Boolean(result.detailStartingUp)} />
        )}
      </section>
    </div>
  );
}
