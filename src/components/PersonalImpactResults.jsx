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
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import UnavailableNotice from "./publication/UnavailableNotice";
import { personalSelection } from "../utils/personalSelection";
import "./PersonalImpactResults.css";

function formatCurrency(value, decimals = 0) {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function PersonalImpactResults({ results, selectedPolicies }) {
  const { measures } = useMeasureCatalogue();
  const selected = selectedPolicies ?? measures.map((measure) => measure.id);
  const selection = personalSelection(selected, measures, results);
  const { years, unmodelled } = selection;
  const modelled = selection.modelled.map((measure) => ({
    ...measure, seriesKey: measure.seriesKey ?? `measure:${measure.id}`,
  }));
  const POLICY_ORDER = modelled.map((measure) => measure.seriesKey);
  const bySeries = Object.fromEntries(modelled.map((measure) => [measure.seriesKey, measure]));
  const POLICY_COLOURS = Object.fromEntries(modelled.map((measure) => [measure.seriesKey, measure.color]));
  const names = Object.fromEntries(modelled.map((measure) => [measure.seriesKey, measure.label]));
  const complete = unmodelled.length === 0 && modelled.length > 0;
  const yearlyData = years.map((year) => {
    const row = { year, total: complete ? 0 : null };
    for (const measure of modelled) {
      row[measure.seriesKey] = results.policies[measure.key].years[year].net_income_change;
      if (complete) row.total += row[measure.seriesKey];
    }
    return row;
  });
  let cumulative = 0;
  const cumulativeData = complete ? yearlyData.map((row) => {
    cumulative += row.total;
    return { year: row.year, yearly: row.total, cumulative };
  }) : [];
  const policySummary = modelled.map((measure) => ({
    id: measure.seriesKey,
    name: measure.label,
    total: yearlyData.reduce((sum, row) => sum + row[measure.seriesKey], 0),
  })).sort((a, b) => b.total - a.total);

  if (!results) return null;

  const totalImpact = complete ? yearlyData.reduce((sum, row) => sum + row.total, 0) : null;
  const impactClass =
    totalImpact > 0 ? "positive" : totalImpact < 0 ? "negative" : "neutral";

  return (
    <div className="personal-impact-results">
      {/* Hero summary */}
      <div className={`impact-summary ${impactClass}`}>
        <div className="summary-label">Your total impact over {years.length} years</div>
        <div className="summary-value">{complete ? formatCurrency(totalImpact) : "Unavailable"}</div>
        <div className="summary-context">
          {!complete ? "Some selected measures are not modelled" : totalImpact > 0
            ? "You gain from these budget policies"
            : totalImpact < 0
              ? "You lose from these budget policies"
              : "These policies have no net effect on you"}
        </div>
      </div>

      {unmodelled.length > 0 && (
        <UnavailableNotice reason={`Not modelled: ${unmodelled.join(", ")}.`}>
          <p>The total for the selected measures is unavailable.</p>
        </UnavailableNotice>
      )}

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
                  names[name] || name,
                ]}
                labelFormatter={(label) => `Year: ${label}`}
              />
              <Legend
                wrapperStyle={{ paddingTop: "20px" }}
                formatter={(value) => names[value] || value}
              />
              <ReferenceLine y={0} stroke="#666" />
              {POLICY_ORDER.map(
                (policyId) =>
                  bySeries[policyId] && (
                    <Bar
                      name={names[policyId]}
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
                className={`policy-row ${policy.total > 0 ? "positive" : policy.total < 0 ? "negative" : ""}`}
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
              No selected measure has a reviewed personal-model result.
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
              {POLICY_ORDER.map(
                (policyId) => {
                  const total = yearlyData.reduce((sum, row) => sum + row[policyId], 0);
                  return (
                    <tr key={policyId}>
                      <td className="policy-cell">{names[policyId]}</td>
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
                        className={`total-cell ${total > 0 ? "positive" : total < 0 ? "negative" : ""}`}
                      >
                        {total !== 0
                          ? formatCurrency(total)
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
                    {complete ? formatCurrency(d.total) : "Unavailable"}
                  </td>
                ))}
                <td
                  className={`total-cell ${totalImpact > 0 ? "positive" : totalImpact < 0 ? "negative" : ""}`}
                >
                  {complete ? formatCurrency(totalImpact) : "Unavailable"}
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
          Personal figures require a reviewed mapping confirming that this
          model implements the published measure parameters and supports every
          displayed year. A missing mapping or unsupported year makes that
          measure unavailable. The net total requires every selected measure.
        </p>
      </div>
    </div>
  );
}

export default PersonalImpactResults;
