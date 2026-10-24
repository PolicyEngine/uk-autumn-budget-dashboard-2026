import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import UnavailableNotice from "./publication/UnavailableNotice";
import { CHART_LOGO } from "../utils/chartLogo";
import { Y_TITLE_GUTTER } from "../utils/chartTheme";
import { buildChartSvg } from "../utils/exportChartAsSvg";
import { downloadFile, downloadSvg } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { lifecycleCsv } from "../utils/chartCsv";
import ChartDownloadMenu from "./ChartDownloadMenu";
import GroupedLegend from "./GroupedLegend";
import { lifecycleSelection, lifecycleTotals } from "../utils/lifecycleSelection";
import PillSelect from "./PillSelect";
import { METHOD_SECTIONS } from "./MethodologyTab";
import { YOUNG_PERSON_PRESETS } from "../utils/youngPersonPresets";
import SectionHeading from "./SectionHeading";
import "./LifecycleCalculator.css";

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

// API URL - supplied by the environment; no fallback.
const getApiUrl = () => {
  const url = process.env.NEXT_PUBLIC_LIFECYCLE_API_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_LIFECYCLE_API_URL is not set. Point it at the 2026 lifecycle API."
    );
  }
  return url;
};

// CPI forecasts for real terms conversion
const CPI_FORECASTS = {
  2024: 0.0233,
  2025: 0.0318,
  2026: 0.0193,
  2027: 0.02,
  2028: 0.02,
  2029: 0.02,
};
const CPI_LONG_TERM = 0.02;

// Default input values
const DEFAULT_INPUTS = {
  current_age: 22,
  current_salary: 30000,
  retirement_age: 67,
  life_expectancy: 85,
  student_loan_debt: 45000,
  salary_sacrifice_per_year: 2000,
  rail_spending_per_year: 2000,
  petrol_spending_per_year: 500,
  dividends_per_year: 500,
  savings_interest_per_year: 500,
  property_income_per_year: 0,
  children_ages: "",
};

// Slider configurations
// The form's steps: the inputs each one asks for, then the results
const WIZARD_STEPS = [
  { title: "About you", fields: ["current_age", "retirement_age", "life_expectancy"] },
  { title: "Earnings", fields: ["current_salary", "salary_sacrifice_per_year"] },
  {
    title: "Other income",
    fields: ["dividends_per_year", "savings_interest_per_year", "property_income_per_year"],
  },
  { title: "Student loan", fields: ["student_loan_debt"] },
  { title: "Spending", fields: ["rail_spending_per_year", "petrol_spending_per_year"] },
  { title: "Family", fields: ["children_ages"] },
  { title: "Results", fields: [] },
];

// Hints for fields whose config has no explanation of its own
const FIELD_HINTS = {
  current_age: "Your age now.",
  retirement_age: "The age you stop working.",
  life_expectancy: "The projection runs to this age.",
  student_loan_debt: "Plan 2 balance when you start work. It changes with interest and repayments.",
};

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, step: 0, maxStep: 0, presetId: null };

// The price base for "real terms": this dashboard's year
const PRICE_BASE_YEAR = 2026;
const PRICE_LABEL = `${PRICE_BASE_YEAR} £`;

const SLIDER_CONFIGS = [
  {
    id: "current_age",
    label: "Age",
    min: 18,
    max: 80,
    step: 1,
    format: (v) => v.toString(),
  },
  {
    id: "current_salary",
    label: "Salary",
    min: 0,
    max: 200000,
    step: 1000,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Your salary in 2026. Grows with age-based earnings trajectory.",
  },
  {
    id: "retirement_age",
    label: "Retirement age",
    min: 55,
    max: 100,
    step: 1,
    format: (v) => v.toString(),
  },
  {
    id: "life_expectancy",
    label: "Life expectancy",
    min: 60,
    max: 100,
    step: 1,
    format: (v) => v.toString(),
  },
  {
    id: "student_loan_debt",
    label: "Student loan debt",
    min: 0,
    max: 100000,
    step: 5000,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Initial debt at graduation. Evolves based on interest and repayments.",
  },
  {
    id: "salary_sacrifice_per_year",
    label: "Salary sacrifice",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Annual pension contribution via salary sacrifice. Grows with CPI.",
  },
  {
    id: "rail_spending_per_year",
    label: "Rail spending",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Annual rail spending (fixed nominal). Policy impact uses RPI fare growth.",
  },
  {
    id: "petrol_spending_per_year",
    label: "Petrol spending",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Annual petrol spending (fixed nominal). Policy impact uses fuel duty changes.",
  },
  {
    id: "dividends_per_year",
    label: "Dividends",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip: "Annual dividend income. Grows with CPI to maintain real value.",
  },
  {
    id: "savings_interest_per_year",
    label: "Savings interest",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Annual savings interest income. Grows with CPI to maintain real value.",
  },
  {
    id: "property_income_per_year",
    label: "Property income",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
    tooltip:
      "Annual rental/property income. Grows with CPI to maintain real value.",
  },
];

function LifecycleCalculator({ selectedPolicies = [], policies = [], onShowMethod }) {
  const [inputs, setInputs] = useState(() => savedWizard.inputs ?? DEFAULT_INPUTS);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showRealTerms, setShowRealTerms] = useState(true);
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  const catalogue = useMeasureCatalogue();
  const publishedMeasures = policies.length ? policies : catalogue.measures;
  // The lifetime series for the policies selected in the title band
  const selectionKey = selectedPolicies.join(",");
  const selection = useMemo(
    () => lifecycleSelection(selectionKey ? selectionKey.split(",") : [], publishedMeasures, data),
    [selectionKey, publishedMeasures, data],
  );
  const activeReforms = selection.reforms;
  const completeSelection = selection.unmodelled.length === 0;
  // Results show only with data and at least one modelled policy; never £0
  const noPolicies = activeReforms.length === 0;
  const showResults = data.length > 0 && !noPolicies;
  // The form's step; kept between tab switches for the session
  const [step, setStep] = useState(() => savedWizard.step);
  const [maxStep, setMaxStep] = useState(() => savedWizard.maxStep);
  const stepHeadingRef = useRef(null);
  const isResults = step === WIZARD_STEPS.length - 1;
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAge, setModalAge] = useState(null);
  const [modalActiveTab, setModalActiveTab] = useState("summary");
  const chartRef = useRef(null);
  const tooltipRef = useRef(null);
  const previousDataRef = useRef([]);
  const modalBodyRef = useRef(null);

  // Cumulative CPI inflation from the price base (2026) to a year, on the
  // model's own CPI series
  const getCumulativeInflation = useCallback((targetYear) => {
    if (targetYear <= PRICE_BASE_YEAR) return 1.0;
    let factor = 1.0;
    for (let y = PRICE_BASE_YEAR; y < targetYear; y++) {
      const rate = CPI_FORECASTS[y] || CPI_LONG_TERM;
      factor *= 1 + rate;
    }
    return factor;
  }, []);

  // Get display data with real terms conversion
  const displayData = useMemo(() => {
    if (!showRealTerms) return data;
    return data.map((row) => {
      const deflator = getCumulativeInflation(row.year);
      const adjusted = { ...row };
      activeReforms.forEach((r) => {
        adjusted[r.key] = row[r.key] / deflator;
      });
      adjusted.gross_income = row.gross_income / deflator;
      adjusted.baseline_net_income = row.baseline_net_income / deflator;
      adjusted.income_tax = row.income_tax / deflator;
      adjusted.national_insurance = row.national_insurance / deflator;
      adjusted.student_loan_payment = row.student_loan_payment / deflator;
      adjusted.student_loan_debt_remaining =
        row.student_loan_debt_remaining / deflator;
      return adjusted;
    });
  }, [data, showRealTerms, getCumulativeInflation, activeReforms]);

  // Summary over the selected series only
  const summaryStats = useMemo(
    () => lifecycleTotals(displayData, activeReforms),
    [displayData, activeReforms],
  );

  // Parse children ages from string
  const parseChildrenAges = (value) => {
    if (!value || value.trim() === "") return [];
    return value
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n >= 0 && n < 20);
  };

  // Fetch data from API
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const apiInputs = {
        ...inputs,
        children_ages: parseChildrenAges(inputs.children_ages),
      };

      const response = await fetch(`${getApiUrl()}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiInputs),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      previousDataRef.current = data;
      setData(result.data);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [inputs, data]);

  // Initial fetch and URL params
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced fetch on input change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs]);

  // Handle input change
  const handleInputChange = (id, value) => {
    setPresetId(null);
    setInputs((prev) => ({
      ...prev,
      [id]: id === "children_ages" ? value : parseFloat(value),
    }));
  };

  // Format signed currency
  // Tiles: one text colour; the sign is a true minus or a plus
  const formatTileCurrency = (v) => {
    const absVal = d3.format(",.0f")(Math.abs(v));
    return v < 0 ? `\u2212£${absVal}` : `+£${absVal}`;
  };

  const formatSignedCurrency = useCallback((v) => {
    const absVal = d3.format(",.0f")(Math.abs(v));
    return v >= 0 ? `+£${absVal}` : `-£${absVal}`;
  }, []);

  // Get terms suffix for display
  const getTermsSuffix = useCallback(() => {
    return showRealTerms ? ` (${PRICE_LABEL})` : "";
  }, [showRealTerms]);

  // Show modal for a specific age
  const showModal = useCallback(
    (age, initialTab = null) => {
      setModalAge(age);
      if (initialTab) {
        setModalActiveTab(initialTab);
      }
      setModalOpen(true);
    },
    [],
  );

  // Close modal
  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  // Navigate to previous/next age in modal
  const navigateModal = useCallback(
    (direction) => {
      if (modalAge === null || !data.length) return;
      const ages = data.map((d) => d.age).sort((a, b) => a - b);
      const currentIndex = ages.indexOf(modalAge);
      if (direction === "prev" && currentIndex > 0) {
        setModalAge(ages[currentIndex - 1]);
      } else if (direction === "next" && currentIndex < ages.length - 1) {
        setModalAge(ages[currentIndex + 1]);
      }
    },
    [modalAge, data],
  );

  // Keyboard navigation for modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!modalOpen) return;
      if (e.key === "ArrowLeft") navigateModal("prev");
      else if (e.key === "ArrowRight") navigateModal("next");
      else if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, navigateModal, closeModal]);

  // Get current modal row data
  const modalRow = useMemo(() => {
    if (modalAge === null || !data.length) return null;
    return data.find((d) => d.age === modalAge);
  }, [modalAge, data]);

  // Get display modal row (with real terms conversion)
  const displayModalRow = useMemo(() => {
    if (modalAge === null || !displayData.length) return null;
    return displayData.find((d) => d.age === modalAge);
  }, [modalAge, displayData]);

  // Animation duration for smooth transitions
  const ANIMATION_DURATION = 400;

  // Render D3 chart with smooth transitions on update
  useEffect(() => {
    if (!displayData.length || !chartRef.current) return;
    if (!activeReforms.length) {
      d3.select(chartRef.current).selectAll("*").remove();
      return;
    }

    const container = chartRef.current;
    const existingSvg = d3.select(container).select("svg");
    const isUpdate = existingSvg.size() > 0;

    // The left margin keeps the ticks and, left of them, the rotated y-axis title
    const margin = { top: 12, right: 8, bottom: 40, left: 56 + Y_TITLE_GUTTER };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Prepare stacked data
    const stackedData = displayData.map((d) => {
      let posY = 0,
        negY = 0;
      const bars = activeReforms.map((r) => {
        const value = d[r.key] || 0;
        const bar = { key: r.key, value, age: d.age, year: d.year };
        if (value >= 0) {
          bar.y0 = posY;
          bar.y1 = posY + value;
          posY += value;
        } else {
          bar.y1 = negY;
          bar.y0 = negY + value;
          negY += value;
        }
        return bar;
      });
      const netImpact = completeSelection ? posY + negY : null;
      return {
        age: d.age,
        year: d.year,
        bars,
        posTotal: posY,
        negTotal: negY,
        netImpact,
        gross_income: d.gross_income,
        income_tax: d.income_tax,
        national_insurance: d.national_insurance,
        student_loan_payment: d.student_loan_payment,
        student_loan_debt_remaining: d.student_loan_debt_remaining,
        baseline_net_income: d.baseline_net_income,
      };
    });

    const yMax = d3.max(stackedData, (d) => d.posTotal);
    const yMin = d3.min(stackedData, (d) => d.negTotal);
    const yExtent = Math.max(Math.abs(yMax || 0), Math.abs(yMin || 0)) * 1.1 || 1000;

    const x = d3
      .scaleBand()
      .domain(displayData.map((d) => d.age))
      .range([0, width])
      .padding(0.15);

    const y = d3.scaleLinear().domain([-yExtent, yExtent]).range([height, 0]);

    // Line generator for net impact
    const line = d3
      .line()
      .defined((d) => Number.isFinite(d.netImpact))
      .x((d) => x(d.age) + x.bandwidth() / 2)
      .y((d) => y(d.netImpact))
      // Straight segments: one point per year of age, no smoothing overshoot
      .curve(d3.curveLinear);

    const tooltip = d3.select(tooltipRef.current);

    // Tooltip event handlers
    const handleMouseover = function (event, d) {
      tooltip.style("opacity", 1);
      let html = `<div class="tooltip-title">Age ${d.age} (${d.year})</div>`;

      html += `<div class="tooltip-section">`;
      html += `<div class="tooltip-row"><span class="tooltip-label">Gross income</span><span class="tooltip-value">£${d3.format(",.0f")(d.gross_income)}</span></div>`;
      if (d.income_tax > 0) {
        html += `<div class="tooltip-row"><span class="tooltip-label">Income tax</span><span class="tooltip-value">-£${d3.format(",.0f")(d.income_tax)}</span></div>`;
      }
      if (d.national_insurance > 0) {
        html += `<div class="tooltip-row"><span class="tooltip-label">National insurance</span><span class="tooltip-value">-£${d3.format(",.0f")(d.national_insurance)}</span></div>`;
      }
      if (d.student_loan_payment > 0) {
        html += `<div class="tooltip-row"><span class="tooltip-label">Student loan</span><span class="tooltip-value">-£${d3.format(",.0f")(d.student_loan_payment)}</span></div>`;
      }
      html += `</div>`;

      const nonzeroBars = d.bars.filter((b) => b.value !== 0);
      if (nonzeroBars.length > 0) {
        html += `<div class="tooltip-section tooltip-reforms">`;
        nonzeroBars.forEach((bar) => {
          const reform = activeReforms.find((r) => r.key === bar.key);
          html += `<div class="tooltip-row">
            <span class="tooltip-label">${escapeHtml(reform.label)}</span>
            <span class="tooltip-value ${bar.value >= 0 ? "positive" : "negative"}">${formatSignedCurrency(bar.value)}</span>
          </div>`;
        });
        html += `</div>`;
      }

      const total = d3.sum(d.bars, (b) => b.value);
      html += `<div class="tooltip-row tooltip-total">
        <span>Net policy impact</span>
        <span class="tooltip-value">${completeSelection ? formatSignedCurrency(total) : "Unavailable"}</span>
      </div>`;
      html += `<div style="margin-top: 8px; font-size: 0.75rem; color: #94a3b8; text-align: center;">Click for details</div>`;

      tooltip.html(html);
    };

    const handleMousemove = function (event) {
      tooltip
        .style("left", event.clientX + 10 + "px")
        .style("top", event.clientY - 10 + "px");
    };

    const handleMouseout = function () {
      tooltip.style("opacity", 0);
    };

    const handleClick = function (event, d) {
      const mouseY = d3.pointer(event, this)[1];
      let clickedTab = "summary";

      for (const bar of d.bars) {
        if (bar.value === 0) continue;
        const barTop = y(Math.max(bar.y0, bar.y1));
        const barBottom = y(Math.min(bar.y0, bar.y1));
        if (mouseY >= barTop && mouseY <= barBottom) {
          clickedTab = bar.key;
          break;
        }
      }

      tooltip.style("opacity", 0);
      showModal(d.age, clickedTab);
    };

    let svg, chartG;

    if (isUpdate) {
      // UPDATE existing chart with smooth transitions
      svg = existingSvg;
      chartG = svg.select("g");

      // Update y-axis with transition
      chartG
        .select(".axis.y-axis")
        .transition()
        .duration(ANIMATION_DURATION)
        .call(
          d3
            .axisLeft(y)
            .tickFormat((d) => formatSignedCurrency(d))
            .ticks(8),
        );

      // Update grid
      chartG
        .select(".grid")
        .transition()
        .duration(ANIMATION_DURATION)
        .call(d3.axisLeft(y).tickSize(-width).tickFormat("").ticks(8));

      // Update zero line
      chartG
        .select(".zero-line")
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("y1", y(0))
        .attr("y2", y(0));

      // Update bars with animation using data join
      const ageGroups = chartG
        .selectAll(".age-group")
        .data(stackedData, (d) => d.age);

      // Handle entering age groups (new ages)
      const enterGroups = ageGroups
        .enter()
        .append("g")
        .attr("class", "age-group")
        .attr("transform", (d) => `translate(${x(d.age)},0)`);

      enterGroups
        .selectAll("rect")
        .data((d) => d.bars)
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", y(0))
        .attr("width", x.bandwidth())
        .attr("height", 0)
        .attr("fill", (d) => activeReforms.find((r) => r.key === d.key).color)
        .attr("rx", 1);

      // Handle exiting age groups (removed ages)
      ageGroups
        .exit()
        .transition()
        .duration(ANIMATION_DURATION)
        .style("opacity", 0)
        .remove();

      // Update existing groups position
      ageGroups
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("transform", (d) => `translate(${x(d.age)},0)`);

      // Update rects in all groups (both existing and new)
      chartG.selectAll(".age-group").each(function (groupData) {
        const group = d3.select(this);
        // Keyed by series, so changing the selected policies adds and
        // removes the right bars and recolours none
        const rects = group.selectAll("rect").data(groupData.bars, (d) => d.key);

        rects.exit().remove();

        rects
          .enter()
          .append("rect")
          .attr("x", 0)
          .attr("y", y(0))
          .attr("width", x.bandwidth())
          .attr("height", 0)
          .attr("fill", (d) => activeReforms.find((r) => r.key === d.key).color)
          .attr("rx", 1)
          .merge(rects)
          .transition()
          .duration(ANIMATION_DURATION)
          .attr("width", x.bandwidth())
          .attr("y", (d) => y(Math.max(d.y0, d.y1)))
          .attr("height", (d) => Math.abs(y(d.y0) - y(d.y1)));
      });

      // Update x-axis
      chartG
        .select(".axis.x-axis")
        .transition()
        .duration(ANIMATION_DURATION)
        .call(
          d3
            .axisBottom(x)
            .tickValues(
              displayData.filter((d) => d.age % 5 === 0).map((d) => d.age),
            ),
        );

      // The unit follows the Prices choice
      svg
        .select(".chart-unit-label")
        .text(`Change in take-home pay (${showRealTerms ? PRICE_LABEL : "£"} a year)`);

      // Update net impact line
      chartG
        .select(".net-line")
        .datum(stackedData)
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("d", line);

      // Re-apply event handlers to all age groups (including new ones)
      chartG
        .selectAll(".age-group")
        .on("mouseover", handleMouseover)
        .on("mousemove", handleMousemove)
        .on("mouseout", handleMouseout)
        .on("click", handleClick);

    } else {
      // INITIAL render - create chart from scratch
      d3.select(container).selectAll("*").remove();

      svg = d3
        .select(container)
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom);

      // The y-axis title, rotated along the axis left of the ticks (also in
      // the downloads)
      const titleX = Y_TITLE_GUTTER - 5;
      const titleY = margin.top + height / 2;
      svg
        .append("text")
        .attr("class", "chart-unit-label")
        .attr("x", titleX)
        .attr("y", titleY)
        .attr("transform", `rotate(-90, ${titleX}, ${titleY})`)
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .attr("font-weight", 500)
        .attr("fill", "#4B5563")
        .text(`Change in take-home pay (${showRealTerms ? PRICE_LABEL : "£"} a year)`);

      chartG = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      // Grid
      chartG
        .append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickSize(-width).tickFormat("").ticks(8));

      // Zero line
      chartG
        .append("line")
        .attr("class", "zero-line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("stroke", "#333")
        .attr("stroke-width", 2);

      // Age groups
      const ageGroups = chartG
        .selectAll(".age-group")
        .data(stackedData, (d) => d.age)
        .enter()
        .append("g")
        .attr("class", "age-group")
        .attr("transform", (d) => `translate(${x(d.age)},0)`);

      // Bars with initial animation
      ageGroups
        .selectAll("rect")
        .data((d) => d.bars)
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", y(0))
        .attr("width", x.bandwidth())
        .attr("height", 0)
        .attr("fill", (d) => activeReforms.find((r) => r.key === d.key).color)
        .attr("rx", 1)
        .transition()
        .duration(ANIMATION_DURATION)
        .attr("y", (d) => y(Math.max(d.y0, d.y1)))
        .attr("height", (d) => Math.abs(y(d.y0) - y(d.y1)));

      // X-axis
      chartG
        .append("g")
        .attr("class", "axis x-axis")
        .attr("transform", `translate(0,${height})`)
        .call(
          d3
            .axisBottom(x)
            .tickValues(
              displayData.filter((d) => d.age % 5 === 0).map((d) => d.age),
            ),
        );

      // Y-axis
      chartG
        .append("g")
        .attr("class", "axis y-axis")
        .call(
          d3
            .axisLeft(y)
            .tickFormat((d) => formatSignedCurrency(d))
            .ticks(8),
        );

      // Net impact line
      chartG
        .append("path")
        .datum(stackedData)
        .attr("class", "net-line")
        .attr("fill", "none")
        .attr("stroke", "#000000")
        .attr("stroke-width", 2.5)
        .attr("d", line);

      // Apply event handlers
      ageGroups
        .on("mouseover", handleMouseover)
        .on("mousemove", handleMousemove)
        .on("mouseout", handleMouseout)
        .on("click", handleClick);
    }

    // Store current data for next comparison
    previousDataRef.current = displayData;
  }, [displayData, formatSignedCurrency, showModal, showRealTerms, activeReforms, completeSelection]);

  // Downloads: the year-by-year figures as shown (cash or 2026 prices) as
  // CSV, and the chart with its title, legend and logo as SVG or PNG.
  const downloads = useMemo(() => {
    const exportOptions = {
      title: "Lifetime change in take-home pay, by age",
      description: `The change in net income from each policy, year by year over a working life, ${
        showRealTerms ? `in ${PRICE_BASE_YEAR} prices` : "in cash terms"
      }.`,
      legendItems: [
        ...activeReforms.map((r) => ({
          color: r.color,
          label: r.label,
          type: "rect",
          group: r.direction === "revenue" ? "raise" : r.direction === "cost" ? "cost" : "",
        })),
        ...(completeSelection ? [{ color: "#000000", label: "Net impact", type: "line" }] : []),
      ],
      logo: CHART_LOGO,
      svgSelector: "svg",
      reservedLegendHeight: 0,
    };
    return data.length
      ? {
          csv: () =>
            downloadFile(
              lifecycleCsv(
                displayData,
                activeReforms.map((r) => r.key),
                { real: showRealTerms, complete: completeSelection },
              ),
              "lifetime-policy-impact.csv",
              "text/csv;charset=utf-8",
            ),
          png: async () =>
            downloadSvgAsPng(
              await buildChartSvg(chartRef, exportOptions),
              "lifetime-policy-impact",
            ),
          svg: async () => {
            const built = await buildChartSvg(chartRef, exportOptions);
            if (built) downloadSvg(built.svg, "lifetime-policy-impact");
          },
        }
      : {};
  }, [data.length, displayData, showRealTerms, activeReforms, completeSelection]);

  const childrenCount = parseChildrenAges(inputs.children_ages).length;

  const goToStep = (next) => {
    const target = Math.max(0, Math.min(WIZARD_STEPS.length - 1, next));
    setStep(target);
    setMaxStep((reached) => Math.max(reached, target));
  };

  // Focus the step's heading when the step changes (not on first load)
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  // Remember the inputs and step for this session, across tab switches
  useEffect(() => {
    savedWizard.inputs = inputs;
    savedWizard.step = step;
    savedWizard.maxStep = maxStep;
    savedWizard.presetId = presetId;
  }, [inputs, step, maxStep, presetId]);

  // Fill the form from an example; every value stays editable
  const applyPreset = (preset) => {
    setInputs({ ...DEFAULT_INPUTS, ...preset.inputs });
    setPresetId(preset.id);
  };
  const activePreset = YOUNG_PERSON_PRESETS.find((preset) => preset.id === presetId);

  const money = (value) => `£${d3.format(",.0f")(value)}`;
  const inputSummary = [
    `Age ${inputs.current_age}, retiring at ${inputs.retirement_age}`,
    `salary ${money(inputs.current_salary)}`,
    `student loan ${money(inputs.student_loan_debt)}`,
    childrenCount === 0
      ? "no children"
      : `${childrenCount} ${childrenCount === 1 ? "child" : "children"}`,
  ].join(" · ");

  // Detail panels use the catalogue's public explanation and the API result.
  // No policy is recalculated in the browser.
  const renderModalContent = () => {
    if (!displayModalRow) return null;
    const visible = modalActiveTab === "summary"
      ? activeReforms
      : activeReforms.filter((measure) => measure.key === modalActiveTab);
    const netImpact = completeSelection
      ? activeReforms.reduce((sum, measure) => sum + displayModalRow[measure.key], 0)
      : null;
    return (
      <>
        {visible.map((measure) => (
          <div className="calc-section" key={measure.key}>
            <div className="calc-title">
              <span className="calc-dot" style={{ background: measure.color }} />
              {measure.label}
            </div>
            {measure.description && <p>{measure.description}</p>}
            <table className="calc-table"><tbody>
              <tr><td>Year</td><td>{displayModalRow.year}</td></tr>
              <tr className="calc-result"><td>Impact{getTermsSuffix()}</td><td>{formatSignedCurrency(displayModalRow[measure.key])}</td></tr>
            </tbody></table>
          </div>
        ))}
        {modalActiveTab === "summary" && (
          <div className="calc-section">
            <div className="calc-title">Net impact at age {modalAge}</div>
            <p>{netImpact === null ? "Unavailable: some selected measures are not modelled." : formatSignedCurrency(netImpact)}</p>
          </div>
        )}
      </>
    );
  };

  // Get navigation button states
  const getNavStates = () => {
    if (modalAge === null || !data.length) return { prevDisabled: true, nextDisabled: true };
    const ages = data.map((d) => d.age).sort((a, b) => a - b);
    const currentIndex = ages.indexOf(modalAge);
    return {
      prevDisabled: currentIndex <= 0,
      nextDisabled: currentIndex >= ages.length - 1,
    };
  };

  const navStates = getNavStates();

  return (
    <div className="lifecycle-calculator">
      {/* A step-by-step form in one card: a few questions per step, then
          the results. Inputs keep their values between steps and tabs. */}
      <SectionHeading
        title="Your lifetime impact"
        subtitle="Answer a few questions about yourself to see how the selected policies change your take-home pay over your working life."
      />
      <div className="wizard">

        <nav className="wizard-steps" aria-label="Steps">
          <ol style={{ "--step-progress": step / (WIZARD_STEPS.length - 1) }}>
            {WIZARD_STEPS.map((wizardStep, index) => (
              <li
                key={wizardStep.title}
                className={`${index < step ? "is-done" : ""} ${
                  index === step ? "is-current-item" : ""
                }`}
                // Circles evenly spaced, the first and last at the edges
                style={{ "--step-position": index / (WIZARD_STEPS.length - 1) }}
              >
                <button
                  type="button"
                  className={`wizard-step-tab ${index === step ? "is-current" : ""} ${
                    index < step ? "is-done" : ""
                  } ${index <= maxStep ? "is-reachable" : ""}`}
                  aria-current={index === step ? "step" : undefined}
                  disabled={index > maxStep}
                  onClick={() => goToStep(index)}
                >
                  <span className="wizard-step-number" aria-hidden="true">
                    {index < step ? "✓" : index + 1}
                  </span>
                  <span className="visually-hidden">Step {index + 1}: </span>
                  <span className="wizard-step-name">{wizardStep.title}</span>
                </button>
              </li>
            ))}
          </ol>
          {/* On a phone: "Step 2 of 7 · Earnings" and a progress bar */}
          <p className="wizard-steps-compact" aria-hidden="true">
            Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step].title}
          </p>
          <div className="wizard-progress" aria-hidden="true">
            <span style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }} />
          </div>
        </nav>

        <section className="wizard-step" aria-labelledby="wizard-step-heading">
          <div className={`wizard-step-header ${isResults ? "is-results" : ""}`}>
            <h3 id="wizard-step-heading" ref={stepHeadingRef} tabIndex={-1}>
              {WIZARD_STEPS[step].title}
            </h3>
            {isResults && (
              <div className="wizard-results-controls">
                <button
                  type="button"
                  className="light-pill-button"
                  onClick={() => goToStep(0)}
                >
                  Edit details
                </button>
                <PillSelect
                  variant="light"
                  name="Prices"
                  prefix="Prices"
                  value={showRealTerms ? "real" : "nominal"}
                  onChange={(value) => setShowRealTerms(value === "real")}
                  options={[
                    { value: "nominal", label: "Nominal" },
                    { value: "real", label: PRICE_LABEL },
                  ]}
                />
              </div>
            )}
            {isResults && <p className="wizard-summary">{inputSummary}</p>}
          </div>

          {step === 0 && (
            <div className="wizard-examples" role="group" aria-labelledby="wizard-examples-label">
              <p id="wizard-examples-label" className="wizard-examples-label">
                Start from an example
              </p>
              <div className="wizard-examples-buttons">
                {YOUNG_PERSON_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`light-pill-button ${presetId === preset.id ? "is-active" : ""}`}
                    aria-pressed={presetId === preset.id}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {activePreset && (
                <p className="wizard-examples-note" role="status">
                  {activePreset.note} Change any value in the steps that follow.
                </p>
              )}
            </div>
          )}

          {!isResults && (
            <div className="wizard-fields">
              {WIZARD_STEPS[step].fields.map((id) => {
                if (id === "children_ages") {
                  return (
                    <div className="control-group" key={id}>
                      <label htmlFor="field-children_ages">
                        Children's ages
                      </label>
                      <div className="slider-container">
                        <input
                          id="field-children_ages"
                          type="text"
                          value={inputs.children_ages}
                          placeholder="e.g. 5, 3, 1"
                          className="text-input"
                          aria-describedby="hint-children_ages"
                          onChange={(e) =>
                            handleInputChange("children_ages", e.target.value)
                          }
                        />
                        <span className="slider-value children-count">
                          {childrenCount === 0
                            ? "0 children"
                            : childrenCount === 1
                              ? "1 child"
                              : `${childrenCount} children`}
                        </span>
                      </div>
                      <p className="field-hint" id="hint-children_ages">
                        Ages in 2026, separated by commas. Leave blank if none.
                      </p>
                    </div>
                  );
                }
                const config = SLIDER_CONFIGS.find((item) => item.id === id);
                return (
                  <div className="control-group" key={id}>
                    <label htmlFor={`field-${id}`}>{config.label}</label>
                    <div className="slider-container">
                      <input
                        id={`field-${id}`}
                        type="range"
                        value={inputs[id]}
                        min={config.min}
                        max={config.max}
                        step={config.step}
                        aria-describedby={`hint-${id}`}
                        aria-valuetext={config.format(inputs[id])}
                        onChange={(e) => handleInputChange(id, e.target.value)}
                      />
                      <span className="slider-value">{config.format(inputs[id])}</span>
                    </div>
                    <p className="field-hint" id={`hint-${id}`}>
                      {FIELD_HINTS[id] ?? config.tooltip}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {isResults && (
            <div className="wizard-results">
                {noPolicies && (
                  <p className="lifecycle-empty" role="status">
                    {selectedPolicies.length
                      ? "No selected measures can be modelled by the lifetime calculator."
                      : "Select at least one measure in the bar above to see your lifetime impact."}
                  </p>
                )}

                {/* Headline figures, as on the other views: only with
                    results, never as £0 */}
                <div
                  className="stat-tiles-row lifecycle-summary"
                  style={{ "--stat-count": 2 }}
                  hidden={!showResults || !completeSelection}
                >
                  <div className="stat-tile">
                    <p className="stat-value">{summaryStats.netTotal === null || !completeSelection ? "Unavailable" : formatTileCurrency(summaryStats.netTotal)}</p>
                    <p className="stat-label">
                      Net lifetime impact{showRealTerms ? ` (${PRICE_LABEL})` : ""}
                    </p>
                  </div>
                  <div className="stat-tile">
                    <p className="stat-value">{summaryStats.avgPerYear === null || !completeSelection ? "Unavailable" : formatTileCurrency(summaryStats.avgPerYear)}</p>
                    <p className="stat-label">
                      Average per year{showRealTerms ? ` (${PRICE_LABEL})` : ""}
                    </p>
                  </div>
                </div>

                {selection.partialCombined && (
                  <p className="lifecycle-note">
                    Some selected measures share a model result. Select the complete
                    published group to include that result.
                  </p>
                )}
                {selectedPolicies.length > 0 && selection.unmodelled.length > 0 && (
                  <UnavailableNotice reason={`Not modelled: ${selection.unmodelled.join(", ")}.`}>
                    <p>The total for the selected measures is unavailable.</p>
                  </UnavailableNotice>
                )}

                {/* Chart */}
                <div className="chart-container" hidden={noPolicies}>
                  {showResults && (
                    <div className="chart-header lifecycle-chart-header">
                      <h4>Lifetime change in take-home pay, by age</h4>
                      <ChartDownloadMenu
                        formats={downloads}
                        chartTitle="Lifetime change in take-home pay, by age"
                      />
                    </div>
                  )}
                  {loading && <div className="loading">Loading...</div>}
                  {error && (
                    <div className="lifecycle-error" role="status">
                      <p className="lifecycle-error-title">Results are not available here.</p>
                      <p>{error}</p>
                    </div>
                  )}
                  <div
                    ref={chartRef}
                    className={`chart ${showResults ? "" : "chart-empty"}`}
                  ></div>

                  {/* Legend: the dashboard's two groups, then the net line */}
                  <div className="lifecycle-legend" hidden={!showResults}>
                    <GroupedLegend
                      items={activeReforms.map((r) => ({
                        label: r.label,
                        color: r.color,
                        raises: r.direction === "revenue",
                        direction: r.direction,
                      }))}
                      netLabel={completeSelection ? "Net impact" : undefined}
                    />
                  </div>

                  {/* PolicyEngine logo, bottom right */}
                  <div className="lifecycle-chart-footer" hidden={!showResults}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="lifecycle-logo" src={CHART_LOGO.href} alt="PolicyEngine" />
                  </div>
                  {/* How the lifetime model works is on the Methodology view */}
                  {onShowMethod && (
                    <p className="lifecycle-method-link">
                      <a
                        href={`?tab=methodology#${METHOD_SECTIONS.lifetime}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onShowMethod(METHOD_SECTIONS.lifetime);
                        }}
                      >
                        About this model
                      </a>{" "}
                      is on the Methodology tab.
                    </p>
                  )}
                </div>
            </div>
          )}
        </section>

        {!isResults && (
        <div className="wizard-actions">
            <>
              <button
                type="button"
                className="light-pill-button"
                onClick={() => goToStep(step - 1)}
                disabled={step === 0}
              >
                Back
              </button>
              <button
                type="button"
                className="wizard-next"
                onClick={() => goToStep(step + 1)}
              >
                {step === WIZARD_STEPS.length - 2 ? "See results" : "Next"}
              </button>
            </>
        </div>
        )}
      </div>

      {/* Tooltip */}
      <div ref={tooltipRef} className="lifecycle-tooltip"></div>

      {/* Modal */}
      {modalOpen && modalRow && (
        <div
          className="modal-overlay active"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <button
                className="modal-nav"
                onClick={() => navigateModal("prev")}
                disabled={navStates.prevDisabled}
                title="Previous year"
              >
                ←
              </button>
              <div className="modal-title">
                Age {modalAge} ({modalRow.year})
              </div>
              <button
                className="modal-nav"
                onClick={() => navigateModal("next")}
                disabled={navStates.nextDisabled}
                title="Next year"
              >
                →
              </button>
              <button className="modal-close" onClick={closeModal}>
                ×
              </button>
            </div>
            <div className="modal-body" ref={modalBodyRef}>
              <div className="tab-bar">
                {[
                  { key: "summary", label: "Summary" },
                  ...activeReforms.map((measure) => ({ key: measure.key, label: measure.label })),
                ].map((tab) => (
                  <button
                    key={tab.key}
                    className={`detail-tab modal-tab ${modalActiveTab === tab.key ? "active" : ""}`}
                    onClick={() => setModalActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="modal-panel">{renderModalContent()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LifecycleCalculator;
