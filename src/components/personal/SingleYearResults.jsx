import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import { fiscalYearTick } from "../../utils/chartTheme";
import { areaName, headlineVerb, money, policyRows, signedPercent } from "../../utils/singleYear";
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
      value: money(data.councilTax.amount),
      detail:
        data.councilTax.source === "estimated"
          ? `band ${data.councilTax.band}, region average`
          : "as entered",
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

const changeClass = (value) => (value > 0 ? "is-gain" : value < 0 ? "is-loss" : "is-zero");

/**
 * The household's headline: one sentence with the change (the only place
 * it appears), then one line of what the figures assume.
 */
export function SingleYearHeadline({ result, year, policies = [], noPolicies, renting = false }) {
  const { status, data, error, stale, retry } = result;
  // The figures' own year: while a new year loads, the old figures keep
  // their year, never the one just chosen
  const yearLabel = fiscalYearTick(data?.year ?? year);
  const showLoading = useDelayed(status === "loading" && !data);

  if (noPolicies) {
    return (
      <p className="household-empty" role="status">
        Select at least one policy in the bar above to see your household&apos;s
        net income.
      </p>
    );
  }

  const totals = data ? headlineTotals(data.net) : null;
  return (
    <div className="single-year-headline" aria-busy={status === "loading"}>
      {stale && status !== "error" && (
        <p className="single-year-updating" role="status">
          Updating for {fiscalYearTick(year)} and the policies now selected; the figures below are the last ones
          calculated.
        </p>
      )}
      {status === "error" && <SingleYearError error={error} onRetry={retry} />}
      {status === "loading" && !data && (
        <p className="single-year-quiet" role="status">
          {showLoading ? "Calculating your household…" : " "}
        </p>
      )}
      {data && status !== "error" && (
        <div className={stale ? "single-year-stale is-stale" : undefined} aria-busy={stale || undefined}>
          {/* The headline, as Spring Statement 2026 words it: one sentence,
              the change in it; the before and after are in the breakdown */}
          <div className={`single-year-banner ${changeClass(totals.change)} ${stale ? "is-stale" : ""}`}>
            <p>
              {`The selected policies would ${headlineVerb(totals.change)} your household's annual net income`}
              {totals.change !== 0 && (
                <>
                  {" "}by <span className="single-year-amount">{money(Math.abs(totals.change))}</span>
                  {signedPercent(totals.change, totals.before) && (
                    <span className="single-year-pct"> ({signedPercent(totals.change, totals.before)})</span>
                  )}
                </>
              )}{" "}
              in {yearLabel}
            </p>
          </div>
          <dl className="single-year-assumptions" aria-label="Assumptions">
            {assumptionItems(data, yearLabel, { renting, policies }).map((item) => (
              <div key={item.id} className="single-year-assumption">
                <dt>{item.label}: </dt>
                <dd>
                  {item.value}
                  {item.detail && <span className="single-year-assumption-detail"> ({item.detail})</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Pending({ text }) {
  const shown = useDelayed(true);
  return (
    <div className="card single-year-card single-year-pending" aria-busy="true">
      <p className="single-year-quiet" role="status">
        {shown ? text : " "}
      </p>
    </div>
  );
}

/**
 * The household's results below the wizard's card, in Spring Statement
 * 2026's order: the breakdown of net income (with how it is calculated),
 * then this dashboard's extras, change by policy and across earnings (with
 * the marginal tax rate in a closed expander).
 */
export function SingleYearDetails({ result, year, policies }) {
  const { data, detailStatus, detailError, retry, stale } = result;
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
      <SectionHeading
        title="Breakdown of household net income"
        subtitle="Market income, taxes and benefits before and after the selected policies. Open a row to see each tax or benefit."
      />
      <section className="report-section">
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

      <SectionHeading
        title="Change by policy"
        subtitle="How much each selected policy adds to or takes from your household's net income."
      />
      <section className="report-section">
        {bars ? (
          <PolicyBars
            rows={bars.rows}
            noEffect={bars.noEffect}
            underAPound={bars.underAPound}
            notes={bars.notes}
            yearLabel={yearLabel}
          />
        ) : detailFailed ? (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The split by policy is not available." />
          </div>
        ) : (
          <Pending text="Working out each policy's share…" />
        )}
      </section>

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
          <Pending text="Calculating across earnings…" />
        )}
      </section>
    </div>
  );
}
