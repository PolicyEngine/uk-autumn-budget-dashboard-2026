import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import {
  POLICY_COLORS_BY_KEY,
  PERSONAL_IMPACT_POLICY_ORDER,
} from "../utils/policyConfig";
import "./PersonalImpactResults.css";

// Use shared policy colours
const POLICY_COLOURS = POLICY_COLORS_BY_KEY;
const POLICY_ORDER = PERSONAL_IMPACT_POLICY_ORDER;

function formatCurrency(value, decimals = 0) {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function PersonalImpactResults({ results }) {
  // Prepare chart data
  const yearlyData = useMemo(() => {
    if (!results?.years) return [];

    const years = Object.keys(results.years)
      .map(Number)
      .filter((year) => year >= 2026)
      .sort((a, b) => a - b);

    return years.map((year) => {
      const yearData = { year };
      let total = 0;

      POLICY_ORDER.forEach((policyId) => {
        const policy = results.policies?.[policyId];
        if (policy?.years?.[year]) {
          const change = policy.years[year].net_income_change || 0;
          yearData[policyId] = change;
          total += change;
        } else {
          yearData[policyId] = 0;
        }
      });

      yearData.total = total;
      return yearData;
    });
  }, [results]);

  // Cumulative data for line chart
  const cumulativeData = useMemo(() => {
    if (!yearlyData.length) return [];

    let cumulative = 0;
    return yearlyData.map((d) => {
      cumulative += d.total;
      return {
        year: d.year,
        yearly: d.total,
        cumulative,
      };
    });
  }, [yearlyData]);

  // Policy summary (sorted by impact magnitude)
  const policySummary = useMemo(() => {
    if (!results?.policies) return [];

    return POLICY_ORDER.map((policyId) => ({
      id: policyId,
      name: results.policies[policyId]?.name || policyId,
      total: results.policies[policyId]?.total_impact || 0,
    }))
      .filter((p) => p.total !== 0)
      .sort((a, b) => b.total - a.total);
  }, [results]);

  if (!results) return null;

  const totalImpact = results.totals?.cumulative || 0;
  const impactClass =
    totalImpact > 0 ? "positive" : totalImpact < 0 ? "negative" : "neutral";

  return (
    <div className="personal-impact-results">
      {/* Hero summary */}
      <div className={`impact-summary ${impactClass}`}>
        <div className="summary-label">Your total impact over 5 years</div>
        <div className="summary-value">{formatCurrency(totalImpact)}</div>
        <div className="summary-context">
          {totalImpact > 0
            ? "You gain from these budget policies"
            : totalImpact < 0
              ? "You lose from these budget policies"
              : "These policies have no net effect on you"}
        </div>
      </div>

      {/* Year-by-year breakdown */}
      <div className="results-section">
        <h3>Impact by year</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={yearlyData}
              margin={{ top: 20, right: 30, left: 60, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="year" />
              <YAxis
                tickFormatter={(v) => `£${v.toLocaleString("en-GB")}`}
                label={{
                  value: "Annual change (£)",
                  angle: -90,
                  position: "insideLeft",
                  dx: -20,
                  style: { textAnchor: "middle" },
                }}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(value),
                  results.policies?.[name]?.name || name,
                ]}
                labelFormatter={(label) => `Year: ${label}`}
              />
              <Legend
                wrapperStyle={{ paddingTop: "20px" }}
                formatter={(value) => results.policies?.[value]?.name || value}
              />
              <ReferenceLine y={0} stroke="#666" />
              {POLICY_ORDER.map(
                (policyId) =>
                  results.policies?.[policyId] && (
                    <Bar
                      key={policyId}
                      dataKey={policyId}
                      stackId="a"
                      fill={POLICY_COLOURS[policyId]}
                    />
                  ),
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumulative impact over time */}
      <div className="results-section">
        <h3>Cumulative impact</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart
              data={cumulativeData}
              margin={{ top: 20, right: 30, left: 60, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis dataKey="year" />
              <YAxis
                tickFormatter={(v) => `£${v.toLocaleString("en-GB")}`}
                label={{
                  value: "Cumulative change (£)",
                  angle: -90,
                  position: "insideLeft",
                  dx: -20,
                  style: { textAnchor: "middle" },
                }}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(value),
                  name === "cumulative" ? "Cumulative total" : "This year",
                ]}
                labelFormatter={(label) => `Year: ${label}`}
              />
              <ReferenceLine y={0} stroke="#666" />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#319795"
                strokeWidth={3}
                dot={{ fill: "#319795", r: 5 }}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Policy breakdown */}
      <div className="results-section">
        <h3>Impact by policy</h3>
        <div className="policy-breakdown">
          {policySummary.length > 0 ? (
            policySummary.map((policy) => (
              <div
                key={policy.id}
                className={`policy-row ${policy.total > 0 ? "positive" : "negative"}`}
              >
                <div
                  className="policy-color"
                  style={{ backgroundColor: POLICY_COLOURS[policy.id] }}
                />
                <span className="policy-name">{policy.name}</span>
                <span className="policy-value">
                  {formatCurrency(policy.total)}
                </span>
              </div>
            ))
          ) : (
            <p className="no-impact">
              None of the selected policies affect your household.
            </p>
          )}
        </div>
      </div>

      {/* Year-by-year table */}
      <div className="results-section">
        <h3>Detailed breakdown</h3>
        <div className="table-container">
          <table className="impact-table">
            <thead>
              <tr>
                <th>Policy</th>
                {yearlyData.map((d) => (
                  <th key={d.year}>{d.year}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_ORDER.filter((id) => results.policies?.[id]).map(
                (policyId) => {
                  const policy = results.policies[policyId];
                  return (
                    <tr key={policyId}>
                      <td className="policy-cell">{policy.name}</td>
                      {yearlyData.map((d) => (
                        <td
                          key={d.year}
                          className={
                            d[policyId] > 0
                              ? "positive"
                              : d[policyId] < 0
                                ? "negative"
                                : ""
                          }
                        >
                          {d[policyId] !== 0
                            ? formatCurrency(d[policyId])
                            : "—"}
                        </td>
                      ))}
                      <td
                        className={`total-cell ${policy.total_impact > 0 ? "positive" : policy.total_impact < 0 ? "negative" : ""}`}
                      >
                        {policy.total_impact !== 0
                          ? formatCurrency(policy.total_impact)
                          : "—"}
                      </td>
                    </tr>
                  );
                },
              )}
              <tr className="total-row">
                <td>Net impact</td>
                {yearlyData.map((d) => (
                  <td
                    key={d.year}
                    className={
                      d.total > 0 ? "positive" : d.total < 0 ? "negative" : ""
                    }
                  >
                    {formatCurrency(d.total)}
                  </td>
                ))}
                <td
                  className={`total-cell ${totalImpact > 0 ? "positive" : totalImpact < 0 ? "negative" : ""}`}
                >
                  {formatCurrency(totalImpact)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology note */}
      <div className="methodology-note">
        <h4>About this calculation</h4>
        <p>
          This calculation uses policyengine.py to model how each Autumn Budget
          2026 policy affects your household&apos;s net income. The model
          accounts for income tax, National Insurance, benefits, and other taxes
          and transfers. Children are automatically aged each year, and your
          income grows at the specified rate. Results compare the budget
          policies against their stated baseline scenarios. Bus fare savings
          are represented as an imputed service benefit, not cash income;
          household region proxies eligible bus services. Capital gains use
          a simplified model input and cannot represent separate gain schedules.
        </p>
      </div>
    </div>
  );
}

export default PersonalImpactResults;
