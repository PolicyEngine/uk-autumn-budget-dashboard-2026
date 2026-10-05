import { useState } from "react";
import MockPersonalImpactForm from "./MockPersonalImpactForm";
import PersonalImpactResults from "./PersonalImpactResults";
import { PERSONAL_IMPACT_POLICY_ORDER } from "../utils/policyConfig";
import "./PersonalImpactTab.css";

export default function PersonalImpactTab({ selectedPolicies = PERSONAL_IMPACT_POLICY_ORDER }) {
  const policyIds = selectedPolicies.filter((id) => PERSONAL_IMPACT_POLICY_ORDER.includes(id));
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  async function calculate(inputs) {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/personal-impact`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...inputs, policy_ids: policyIds }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(typeof detail?.error === "string"
          ? detail.error
          : response.status === 503
            ? "The household calculator is temporarily unavailable. Please retry later."
            : "Could not calculate your results. Please check the inputs and retry.");
      }
      setResults(await response.json());
    } catch (err) {
      setError(err.message === "Failed to fetch"
        ? "Could not reach the household calculator. Please retry."
        : err.message);
    }
    finally { setLoading(false); }
  }
  return <div className="personal-impact-tab">
    <p>MOCK rehearsal. Household impacts become available after the statement-derived measures are registered. Fiscal-year comparisons must use the reconciliation method recorded for each measure.</p>
    {policyIds.length ? <MockPersonalImpactForm onSubmit={calculate} isLoading={loading} />
      : <p role="note">Awaiting the 12:30 statement. No drill measures are available yet.</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Calculating your household impact. This can take a few minutes.</p>}
    <PersonalImpactResults results={results} />
  </div>;
}
