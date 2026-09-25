import { useState } from "react";
import PersonalImpactForm from "./PersonalImpactForm";
import PersonalImpactResults from "./PersonalImpactResults";
import "./PersonalImpactTab.css";

export default function PersonalImpactTab() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  async function calculate(inputs) {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/personal-impact`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inputs),
      });
      if (!response.ok) throw new Error("Could not calculate your results. Please retry.");
      setResults(await response.json());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  return <div className="personal-impact-tab">
    <p>See how the three candidate policies affect your household over 2026–2030. Results include changes in realised capital gains and transport savings.</p>
    <PersonalImpactForm onSubmit={calculate} isLoading={loading} />
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Calculating your household impact…</p>}
    <PersonalImpactResults results={results} />
  </div>;
}
