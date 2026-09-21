import { useState, useEffect, useRef } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import HouseholdImpactChart from "./HouseholdImpactChart";
import ConstituencyMap from "./ConstituencyMap";
import "./Results.css";

// Animated number component
function AnimatedNumber({ value, format = (v) => v, duration = 800 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const startValue = displayValue;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (value - startValue) * eased;

      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value]);

  return <span>{format(displayValue)}</span>;
}

function Results({ results, isLoading, selectedPolicies }) {
  const [showReduction, setShowReduction] = useState(true);

  // Download handlers
  const handleDownloadTxt = () => {
    if (!results) return;

    const date = new Date().toISOString().split("T")[0];
    let content = `UK Autumn Budget 2026 Dashboard - Analysis Results\n`;
    content += `Generated: ${new Date().toLocaleString("en-GB")}\n\n`;
    content += `Selected Policies:\n`;
    content += results.policies.map((p) => `- ${p.name}`).join("\n");
    content += `\n\n`;
    content += `Affected Households: ${results.affectedHouseholds.toLocaleString("en-GB")}\n`;
    content += `Average Impact: £${results.averageImpact}\n`;
    content += `Absolute Poverty Reduction (AHC): ${(results.povertyImpact.absolute.baseline - results.povertyImpact.absolute.withPolicies).toFixed(2)}\n`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `uk-budget-analysis-${date}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    if (!results) return;

    const date = new Date().toISOString().split("T")[0];
    let content = `Metric,Value\n`;
    content += `Affected Households,${results.affectedHouseholds}\n`;
    content += `Average Impact,£${results.averageImpact}\n`;
    content += `Baseline Absolute Poverty (AHC),${results.povertyImpact.absolute.baseline}%\n`;
    content += `Reformed Absolute Poverty (AHC),${results.povertyImpact.absolute.withPolicies}%\n`;
    content += `Baseline Relative Poverty (AHC),${results.povertyImpact.relative.baseline}%\n`;
    content += `Reformed Relative Poverty (AHC),${results.povertyImpact.relative.withPolicies}%\n`;

    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `uk-budget-analysis-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Listen for download events
  useEffect(() => {
    const handleTxtEvent = () => handleDownloadTxt();
    const handleCsvEvent = () => handleDownloadCsv();

    window.addEventListener("downloadDataTxt", handleTxtEvent);
    window.addEventListener("downloadDataCsv", handleCsvEvent);

    return () => {
      window.removeEventListener("downloadDataTxt", handleTxtEvent);
      window.removeEventListener("downloadDataCsv", handleCsvEvent);
    };
  }, [results]);

  if (selectedPolicies.length === 0) {
    const openSidebar = () => {
      window.dispatchEvent(new CustomEvent("toggleSidebar"));
    };

    return (
      <div className="results-empty">
        <div className="empty-state">
          <h2>Welcome to the UK Autumn Budget 2026 dashboard</h2>
          <p>
            Analyse the potential impacts of budget policies on UK households
            and public finances.
          </p>
          <button className="open-sidebar-button" onClick={openSidebar}>
            Open policy options
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="results-loading">
        <div className="loading-spinner"></div>
        <p>Analysing policy impacts...</p>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  // Prepare chart data
  const budgetChartData = results.budgetaryImpact.years.map((year, idx) => {
    const dataPoint = { year };
    results.budgetaryImpact.data.forEach((policy) => {
      dataPoint[policy.policy] = policy.values[idx];
    });
    return dataPoint;
  });

  const povertyChartData = [
    {
      metric: "Absolute poverty (AHC)",
      Baseline: results.povertyImpact.absolute.baseline,
      "With policies": results.povertyImpact.absolute.withPolicies,
    },
    {
      metric: "Relative poverty (AHC)",
      Baseline: results.povertyImpact.relative.baseline,
      "With policies": results.povertyImpact.relative.withPolicies,
    },
  ];

  // Distributional analysis data - 10 deciles
  const distributionalData = [
    { decile: "1st", avgNetIncome: 125 },
    { decile: "2nd", avgNetIncome: 142 },
    { decile: "3rd", avgNetIncome: 158 },
    { decile: "4th", avgNetIncome: 167 },
    { decile: "5th", avgNetIncome: 173 },
    { decile: "6th", avgNetIncome: 165 },
    { decile: "7th", avgNetIncome: 152 },
    { decile: "8th", avgNetIncome: 138 },
    { decile: "9th", avgNetIncome: 121 },
    { decile: "10th", avgNetIncome: 110 },
  ];

  const policyColours = [
    "#319795",
    "#5A8FB8",
    "#B8875A",
    "#5FB88A",
    "#4A7BA7",
    "#C59A5A",
  ];

  const formatCurrency = (value) => `£${value.toFixed(2)}bn`;
  const formatPercent = (value) => `${value.toFixed(1)}%`;
  const formatNumber = (value) => value.toLocaleString("en-GB");

  return (
    <div className="results">
      <section className="results-intro">
        <h2>Analysis overview</h2>
        <p className="section-description">
          This dashboard analyses the potential impacts of selected budget
          policies on UK households and public finances. The analysis is powered
          by{" "}
          <a
            href="https://policyengine.org/uk"
            target="_blank"
            rel="noopener noreferrer"
          >
            PolicyEngine UK
          </a>
          , a free, open-source tool for computing the impact of public policy.
        </p>
      </section>

      <section className="results-section">
        <h2>Key impacts</h2>
        <p className="section-description">
          Summary of the main effects of selected policies on households,
          incomes, and poverty rates.
        </p>
        <div className="impact-cards">
          <div className="impact-card">
            <div className="impact-label">Affected households</div>
            <div className="impact-value">
              <AnimatedNumber
                value={results.affectedHouseholds}
                format={(v) => Math.round(v).toLocaleString("en-GB")}
              />
            </div>
          </div>
          <div className="impact-card">
            <div className="impact-label">Average impact</div>
            <div className="impact-value">
              £
              <AnimatedNumber
                value={results.averageImpact}
                format={(v) => Math.round(v).toLocaleString("en-GB")}
              />
            </div>
          </div>
          <div className="impact-card">
            <div className="impact-label">Absolute poverty reduction (AHC)</div>
            <div className="impact-value">
              <AnimatedNumber
                value={
                  results.povertyImpact.absolute.baseline -
                  results.povertyImpact.absolute.withPolicies
                }
                format={(v) => `${v.toFixed(2)}`}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Household-level impact visualization */}
      <section className="household-impact-section">
        <h2>Household impact</h2>
        <p className="section-description">
          Explore how selected policies affect individual households across
          different income levels and household compositions. Each dot
          represents a household's potential net income change under the
          proposed reforms.
        </p>
        <HouseholdImpactChart selectedPolicy={selectedPolicies[0]} />
        <div className="household-explanation">
          <p className="explanation-text">
            Each dot represents one household. The chart shows how the selected
            policy would affect households across different income levels. Use
            the questions on the left to find households similar to yours and
            see how they would be affected.
          </p>
        </div>
      </section>

      <section className="chart-section">
        <h2>Fiscal impact over time</h2>
        <p className="chart-description">
          Projected impact on Government revenues and expenditure from selected
          policies over the period 2025 to 2030, measured in billions of pounds.
          Positive values indicate revenue gains or expenditure reductions,
          whilst negative values represent costs to the Treasury.
        </p>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={budgetChartData}
            margin={{ top: 20, right: 30, left: 90, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="year" />
            <YAxis
              label={{
                value: "Impact (£bn)",
                angle: -90,
                position: "insideLeft",
                dx: -30,
                style: { textAnchor: "middle" },
              }}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              formatter={(value) => formatCurrency(value)}
              labelFormatter={(label) => `Year: ${label}`}
            />
            <Legend wrapperStyle={{ paddingTop: "20px" }} />
            {results.budgetaryImpact.data.map((policy, idx) => (
              <Bar
                key={policy.policy}
                dataKey={policy.policy}
                fill={policyColours[idx % policyColours.length]}
                name={policy.policy}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="chart-section">
        <h2>Distributional analysis</h2>
        <p className="chart-description">
          Average net income change by income decile, showing how selected
          policies affect households across the income distribution. This
          analysis reveals the proportion of winners and losers from the
          proposed reforms, with each decile representing 10% of households
          ranked by equivalised household income.
        </p>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={distributionalData}
            margin={{ top: 20, right: 30, left: 90, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="decile" />
            <YAxis
              label={{
                value: "Average net income change (£)",
                angle: -90,
                position: "insideLeft",
                dx: -30,
                style: { textAnchor: "middle" },
              }}
            />
            <Tooltip
              formatter={(value) => `£${value}`}
              labelFormatter={(label) => `${label} decile`}
            />
            <Bar
              dataKey="avgNetIncome"
              fill="#319795"
              name="Average net income change"
            />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="chart-section">
        <div className="chart-header">
          <div>
            <h2>Poverty impact</h2>
            <p className="chart-description">
              Comparison of poverty rates (After Housing Costs) before and after
              implementing selected policies, showing the reduction in both
              absolute and relative poverty measures across the UK population.
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={povertyChartData}
            margin={{ top: 20, right: 30, left: 90, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis dataKey="metric" />
            <YAxis
              label={{
                value: "Poverty rate (%)",
                angle: -90,
                position: "insideLeft",
                dx: -30,
                style: { textAnchor: "middle" },
              }}
              tickFormatter={formatPercent}
            />
            <Tooltip formatter={(value) => formatPercent(value)} />
            <Legend wrapperStyle={{ paddingTop: "20px" }} />
            <Bar dataKey="Baseline" fill="#9CA3AF" name="Baseline" />
            <Bar dataKey="With policies" fill="#319795" name="With policies" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Geographic constituency analysis */}
      <section className="constituency-section">
        <ConstituencyMap selectedPolicies={selectedPolicies} />
      </section>
    </div>
  );
}

export default Results;
