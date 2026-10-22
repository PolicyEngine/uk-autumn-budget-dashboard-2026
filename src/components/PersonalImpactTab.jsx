import { useEffect, useRef, useState } from "react";
import HouseholdForm from "./HouseholdForm";
import HouseholdImpactResult from "./HouseholdImpactResult";
import YearSlider from "./YearSlider";
import useChartYear from "../hooks/useChartYear";
import "./PersonalImpactTab.css";

// The Next.js route that forwards to the household impact app on Modal
const HOUSEHOLD_IMPACT_ROUTE = "/api/household-impact";
// Show "Calculating…" only for answers slower than this, to avoid a flash
const LOADING_DELAY_MS = 300;
const UNAVAILABLE = "Household results aren't available yet.";

/**
 * The Personal impact view: a few questions about a household, then its
 * net income in the card's year before and after the selected policies,
 * calculated by the household impact app with policyengine.py.
 */
function PersonalImpactTab({ selectedPolicies, policies, initialYear }) {
  const [year, setYear] = useChartYear(initialYear);
  // idle, waiting (under LOADING_DELAY_MS), loading, done, unavailable or failed
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState(null);
  const loadingTimer = useRef(null);
  const latestRequest = useRef(0);

  useEffect(() => () => clearTimeout(loadingTimer.current), []);

  const calculate = async (household) => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    const isLatest = () => latestRequest.current === request;
    setProblem(null);
    setStatus("waiting");
    clearTimeout(loadingTimer.current);
    loadingTimer.current = setTimeout(() => {
      if (isLatest()) setStatus("loading");
    }, LOADING_DELAY_MS);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH || ""}${HOUSEHOLD_IMPACT_ROUTE}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year, policies: selectedPolicies, household }),
        },
      );
      if (!isLatest()) return;
      if (response.status === 404 || response.status === 503) {
        setStatus("unavailable");
        return;
      }
      const body = await response.json();
      if (!isLatest()) return;
      if (!response.ok) {
        setProblem(typeof body?.detail === "string" ? body.detail : "The calculation failed.");
        setStatus("failed");
        return;
      }
      setResult(body);
      setStatus("done");
    } catch {
      if (isLatest()) setStatus("unavailable");
    } finally {
      if (isLatest()) clearTimeout(loadingTimer.current);
    }
  };

  const noPolicies = selectedPolicies.length === 0;
  const busy = status === "waiting" || status === "loading";

  return (
    <div className="personal-impact-tab">
      <div className="personal-impact-card">
        <div className="chart-header">
          <div>
            <h3>Your household</h3>
            <p className="chart-description">
              Answer a few questions to see your household&apos;s net income in
              the year shown, before and after the selected policies, calculated
              with PolicyEngine&apos;s model.
            </p>
          </div>
        </div>
        <div className="chart-controls">
          <YearSlider selectedYear={year} onYearChange={setYear} />
        </div>

        {noPolicies && (
          <p className="personal-impact-notice">
            Choose at least one policy in the bar above.
          </p>
        )}
        <HouseholdForm
          selectedPolicies={selectedPolicies}
          onSubmit={calculate}
          disabled={noPolicies || busy}
        />

        <div className="personal-impact-status" aria-live="polite">
          {status === "loading" && <p>Calculating…</p>}
          {status === "unavailable" && <p>{UNAVAILABLE}</p>}
          {status === "failed" && <p>{problem}</p>}
        </div>

        {status === "done" && result && (
          <HouseholdImpactResult result={result} policies={policies} />
        )}
      </div>
    </div>
  );
}

export default PersonalImpactTab;
