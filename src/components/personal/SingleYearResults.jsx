import { useEffect, useState } from "react";
import SectionHeading from "../SectionHeading";
import Disclosure from "../Disclosure";
import { METHOD_SECTIONS } from "../MethodologyTab";
import { fiscalYearTick } from "../../utils/chartTheme";
import { money, policyRows, signedMoney, signedPercent } from "../../utils/singleYear";
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
    <div className="lifecycle-error single-year-error" role="alert">
      <p className="lifecycle-error-title">{title}</p>
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

const changeClass = (value) => (value > 0 ? "is-gain" : value < 0 ? "is-loss" : "is-zero");

/**
 * The Single-year effect inside the wizard's card: the lede, the three
 * tiles (the only place the totals appear), the salary used and what is
 * not included.
 */
export function SingleYearHeadline({ result, year, policies = [], noPolicies }) {
  const yearLabel = fiscalYearTick(year);
  const { status, data, error, stale, retry } = result;
  const showLoading = useDelayed(status === "loading" && !data);
  const showUpdating = useDelayed(status === "loading" && Boolean(data));

  if (noPolicies) {
    return (
      <p className="lifecycle-empty" role="status">
        Select at least one policy in the bar above to see your household&apos;s
        net income.
      </p>
    );
  }

  const totals = data ? headlineTotals(data.net) : null;
  return (
    <div className="single-year-headline" aria-busy={status === "loading"}>
      <p className="single-year-lede">
        Your household&apos;s net income in {yearLabel}, with and without the selected policies.
        {showUpdating && <span className="single-year-updating"> Updating…</span>}
      </p>
      {status === "error" && <SingleYearError error={error} onRetry={retry} />}
      {status === "loading" && !data && (
        <p className="single-year-quiet" role="status">
          {showLoading ? "Calculating your household…" : " "}
        </p>
      )}
      {data && status !== "error" && (
        <>
          <div className={`stat-tiles-row single-year-tiles ${stale ? "is-stale" : ""}`} style={{ "--stat-count": 3 }}>
            <div className="stat-tile">
              <p className="stat-value">{money(totals.before)}</p>
              <p className="stat-label">Net income before</p>
              <p className="stat-sub">Pre-Budget law, {yearLabel}</p>
            </div>
            <div className="stat-tile">
              <p className="stat-value">{money(totals.after)}</p>
              <p className="stat-label">Net income after</p>
              <p className="stat-sub">With the selected policies, {yearLabel}</p>
            </div>
            <div className={`stat-tile single-year-change ${changeClass(totals.change)}`}>
              <p className="stat-value">
                {signedMoney(totals.change)}
                {signedPercent(totals.change, totals.before) && (
                  <span className="stat-extra"> ({signedPercent(totals.change, totals.before)})</span>
                )}
              </p>
              <p className="stat-label">Change a year</p>
              <p className="stat-sub">{totals.change > 0 ? "Higher" : totals.change < 0 ? "Lower" : "Unchanged"} with the selected policies</p>
            </div>
          </div>
          <div className="single-year-notes">
            {data.salaryUsed !== null && (
              <p>
                Your salary in {yearLabel}: {money(data.salaryUsed)}, grown from 2026 with the OBR&apos;s
                average earnings forecast.
              </p>
            )}
            {data.notModelled.map((item) => (
              <p key={item.id}>
                Not included in this view: {policies.find((policy) => policy.id === item.id)?.name ?? item.id}. {item.reason}
              </p>
            ))}
          </div>
        </>
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
 * The Single-year effect below the wizard's card: change by policy,
 * change by tax and benefit, and across earnings (with the marginal tax
 * rate in a closed expander), then how it is calculated.
 */
export function SingleYearDetails({ result, year, policies, onShowMethod }) {
  const yearLabel = fiscalYearTick(year);
  const { data, detailStatus, detailError, retry } = result;
  if (!data || result.status === "error") return null;
  const totals = headlineTotals(data.net);
  const bars = data.byPolicy ? policyRows(data.byPolicy, totals.change, policies) : null;
  const detailFailed = detailStatus === "error";

  return (
    <div className="single-year-details">
      <SectionHeading
        title="Change by policy"
        subtitle="How much each selected policy adds to or takes from your household's net income."
      />
      <section className="report-section">
        {bars ? (
          <PolicyBars rows={bars.rows} noEffect={bars.noEffect} yearLabel={yearLabel} />
        ) : detailFailed ? (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The split by policy is not available." />
          </div>
        ) : (
          <Pending text="Working out each policy's share…" />
        )}
      </section>

      <SectionHeading
        title="Change by tax and benefit"
        subtitle="Each tax and benefit before and after the selected policies."
      />
      <section className="report-section">
        {data.programmes ? (
          <ProgrammeTable programmes={data.programmes} yearLabel={yearLabel} />
        ) : (
          <div className="card single-year-card">
            <p className="single-year-quiet">The breakdown by tax and benefit is not available for this answer.</p>
          </div>
        )}
      </section>

      <SectionHeading
        title="Across earnings"
        subtitle="How your household's net income changes as your salary varies."
      />
      <section className="report-section">
        {data.sweep ? (
          <EarningsChart
            sweep={data.sweep}
            salary={data.salaryUsed}
            yearLabel={yearLabel}
            footer={
              <Disclosure inCard title="Marginal tax rate across earnings">
                <MarginalRateChart sweep={data.sweep} salary={data.salaryUsed} yearLabel={yearLabel} />
              </Disclosure>
            }
          />
        ) : detailFailed ? (
          <div className="card single-year-card">
            <SingleYearError error={detailError} onRetry={retry} title="The earnings chart is not available." />
          </div>
        ) : (
          <Pending text="Calculating across earnings…" />
        )}
      </section>

      <section className="report-section single-year-about">
        <Disclosure title="How this is calculated">
          <ul className="single-year-method">
            <li>One household and one year ({yearLabel}), on the same engine and measures as the national figures.</li>
            <li>
              Net income is before housing costs: rent is not taken off, and the change is the same
              either way, as no selected policy changes rent.
            </li>
            <li>Your salary is entered for 2026 and grown to {yearLabel} with the OBR&apos;s average earnings forecast.</li>
            <li>
              Change by policy adds the policies one at a time in the publication&apos;s order, so the rows
              add up to the change in the tiles; where policies interact, the order matters.
            </li>
            <li>The marginal tax rate is the share of an extra pound of salary lost to taxes and withdrawn benefits.</li>
            {data.versions?.policyengine && (
              <li>
                Engine: policyengine {data.versions.policyengine}
                {data.versions.policyengine_uk ? `, policyengine-uk ${data.versions.policyengine_uk}` : ""}.
              </li>
            )}
          </ul>
        </Disclosure>
        {onShowMethod && (
          <p className="lifecycle-method-link">
            <a
              href={`?tab=methodology#${METHOD_SECTIONS.singleYear}`}
              onClick={(event) => {
                event.preventDefault();
                onShowMethod(METHOD_SECTIONS.singleYear);
              }}
            >
              About this calculation
            </a>{" "}
            is on the Methodology tab.
          </p>
        )}
      </section>
    </div>
  );
}
