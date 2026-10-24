import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { LIFECYCLE_REFORMS } from "../utils/policyConfig";
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
import { RAISER_KEYS } from "./LifecycleAbout";
import { METHOD_SECTIONS } from "./MethodologyTab";
import { YOUNG_PERSON_PRESETS } from "../utils/youngPersonPresets";
import SectionHeading from "./SectionHeading";
import Disclosure from "./Disclosure";
import SubTabs, { SubTabPanel, subTabId } from "./SubTabs";
import { SingleYearDetails, SingleYearHeadline } from "./personal/SingleYearResults";
import useHouseholdImpact from "../hooks/useHouseholdImpact";
import { isRenting } from "../utils/householdImpactApi";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import "./LifecycleCalculator.css";

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

// Use shared policy configuration
const REFORMS = LIFECYCLE_REFORMS;

// Map reform keys to tab names for click-to-tab functionality
const REFORM_KEY_TO_TAB = {
  impact_rail_fare_freeze: "rail-fare",
  impact_fuel_duty_freeze: "fuel-duty",
  impact_threshold_freeze: "tax",
  impact_unearned_income_tax: "unearned-income",
  impact_salary_sacrifice_cap: "salary-sacrifice",
  impact_sl_threshold_freeze: "student-loan",
  impact_two_child_limit: "two-child-limit",
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

// RPI forecasts for detail calculations
const RPI_FORECASTS = {
  2024: 0.0331,
  2025: 0.0416,
  2026: 0.0308,
  2027: 0.03,
  2028: 0.0283,
  2029: 0.0283,
};
const RPI_LONG_TERM = 0.0239;

// Default input values: the lifecycle model's inputs (the Multi-year
// effect); only these go to its API
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

// The household's other answers, for the Single-year effect only: the
// lifetime model does not use them
export const HOUSEHOLD_DEFAULTS = {
  region: "LONDON",
  tenure: "RENT_PRIVATELY",
  monthly_rent: 900,
  student_loan_plan: "PLAN_2",
  has_partner: false,
  partner_age: 30,
  partner_salary: 25000,
  claims_universal_credit: false,
  council_tax_band: "D",
  diesel_spending_per_year: 0,
  monthly_childcare: 0,
};

export const WIZARD_DEFAULTS = { ...DEFAULT_INPUTS, ...HOUSEHOLD_DEFAULTS };

// The lifecycle API's request: its own inputs only
const lifecycleInputs = (inputs) =>
  Object.fromEntries(Object.keys(DEFAULT_INPUTS).map((key) => [key, inputs[key]]));

// The results' two sub-tabs (?sub=single|multi); the first is the default
export const PERSONAL_SUB_TABS = [
  { value: "single", label: "Single-year effect" },
  { value: "multi", label: "Multi-year effect" },
];
const SUB_TAB_PREFIX = "personal";

// Slider configurations
// The form's steps: the inputs each one asks for, then the results
// `more`: optional inputs in a closed "More details" expander
const WIZARD_STEPS = [
  { title: "About you", fields: ["current_age", "region", "retirement_age", "life_expectancy"] },
  { title: "Earnings", fields: ["current_salary", "salary_sacrifice_per_year"] },
  {
    title: "Other income",
    fields: ["dividends_per_year", "savings_interest_per_year", "property_income_per_year"],
  },
  { title: "Student loan", fields: ["student_loan_plan", "student_loan_debt"] },
  {
    title: "Home and spending",
    fields: ["tenure", "monthly_rent", "rail_spending_per_year", "petrol_spending_per_year"],
    more: ["council_tax_band", "diesel_spending_per_year"],
  },
  {
    title: "Family",
    fields: ["has_partner", "partner_age", "partner_salary", "children_ages", "claims_universal_credit"],
    more: ["monthly_childcare"],
  },
  { title: "Results", fields: [] },
];

// Choices from a list
const SELECT_CONFIGS = {
  region: {
    label: "Region",
    options: [
      ["NORTH_EAST", "North East"],
      ["NORTH_WEST", "North West"],
      ["YORKSHIRE", "Yorkshire and the Humber"],
      ["EAST_MIDLANDS", "East Midlands"],
      ["WEST_MIDLANDS", "West Midlands"],
      ["EAST_OF_ENGLAND", "East of England"],
      ["LONDON", "London"],
      ["SOUTH_EAST", "South East"],
      ["SOUTH_WEST", "South West"],
      ["WALES", "Wales"],
      ["SCOTLAND", "Scotland"],
      ["NORTHERN_IRELAND", "Northern Ireland"],
    ],
  },
  tenure: {
    label: "Housing",
    options: [
      ["RENT_PRIVATELY", "Renting privately"],
      ["RENT_FROM_COUNCIL", "Renting from the council"],
      ["RENT_FROM_HA", "Renting from a housing association"],
      ["OWNED_WITH_MORTGAGE", "Own with a mortgage"],
      ["OWNED_OUTRIGHT", "Own outright"],
    ],
  },
  student_loan_plan: {
    label: "Student loan plan",
    options: [
      ["NONE", "No student loan"],
      ["PLAN_1", "Plan 1"],
      ["PLAN_2", "Plan 2"],
      ["PLAN_4", "Plan 4 (Scotland)"],
      ["PLAN_5", "Plan 5"],
      ["POSTGRADUATE", "Postgraduate loan"],
    ],
  },
  council_tax_band: {
    label: "Council tax band",
    options: ["A", "B", "C", "D", "E", "F", "G", "H"].map((band) => [band, `Band ${band}`]),
  },
};

// Yes or no
const CHECK_CONFIGS = {
  has_partner: { label: "I live with a partner" },
  claims_universal_credit: { label: "My household claims Universal Credit" },
};

// Shown only when they apply
const FIELD_APPLIES = {
  monthly_rent: (inputs) => isRenting(inputs.tenure),
  partner_age: (inputs) => inputs.has_partner,
  partner_salary: (inputs) => inputs.has_partner,
  monthly_childcare: (inputs, childrenCount) => childrenCount > 0,
};

// Hints for fields whose config has no explanation of its own
const FIELD_HINTS = {
  current_age: "Your age now.",
  retirement_age: "The age you stop working.",
  life_expectancy: "The projection runs to this age.",
  student_loan_debt: "Plan 2 balance when you start work. It changes with interest and repayments. Only the multi-year effect uses it.",
  region: "Where you live. Scotland has its own income tax rates, and housing support follows local rents.",
  student_loan_plan:
    "Plan 1: started before September 2012, or in Northern Ireland. Plan 2: England or Wales from September 2012 (England to July 2023). Plan 4: Scotland. Plan 5: England from August 2023.",
  tenure: "How you hold your home.",
  monthly_rent: "Rent a month. Universal Credit can help with it.",
  has_partner: "A spouse or partner you live with. Universal Credit and the High Income Child Benefit Charge are assessed per couple.",
  partner_age: "Your partner's age now.",
  partner_salary: "Your partner's salary in 2026.",
  claims_universal_credit: "Tick if your household claims Universal Credit, or would if entitled.",
  council_tax_band: "Band D if you are not sure.",
  diesel_spending_per_year: "Annual diesel spending.",
  monthly_childcare: "Paid childcare a month, for all children together.",
};

// The form's last state, kept for the session so switching tabs keeps it
const savedWizard = { inputs: null, step: 0, maxStep: 0, presetId: null };

/** Forget the form's saved state (a new session; for tests). */
export function resetSavedWizard() {
  Object.assign(savedWizard, { inputs: null, step: 0, maxStep: 0, presetId: null });
}

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
      "Annual pension contribution via salary sacrifice. Grows with CPI. Cap of £2k from April 2029.",
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
  {
    id: "monthly_rent",
    label: "Monthly rent",
    min: 0,
    max: 4000,
    step: 25,
    format: (v) => `£${d3.format(",.0f")(v)}`,
  },
  {
    id: "partner_age",
    label: "Partner's age",
    min: 18,
    max: 80,
    step: 1,
    format: (v) => v.toString(),
  },
  {
    id: "partner_salary",
    label: "Partner's salary",
    min: 0,
    max: 200000,
    step: 1000,
    format: (v) => `£${d3.format(",.0f")(v)}`,
  },
  {
    id: "diesel_spending_per_year",
    label: "Diesel spending",
    min: 0,
    max: 10000,
    step: 100,
    format: (v) => `£${d3.format(",.0f")(v)}`,
  },
  {
    id: "monthly_childcare",
    label: "Monthly childcare",
    min: 0,
    max: 3000,
    step: 25,
    format: (v) => `£${d3.format(",.0f")(v)}`,
  },
];

function LifecycleCalculator({
  selectedPolicies = [],
  policies = [],
  onShowMethod,
  year = DEFAULT_DISPLAY_YEAR,
  subTab: subTabProp,
  onSubTabChange,
}) {
  const [inputs, setInputs] = useState(() => ({ ...WIZARD_DEFAULTS, ...savedWizard.inputs }));
  // The results' sub-tab: from PersonalImpactTab (?sub=), else its own
  const [ownSubTab, setOwnSubTab] = useState(PERSONAL_SUB_TABS[0].value);
  const subTab = subTabProp ?? ownSubTab;
  const setSubTab = onSubTabChange ?? setOwnSubTab;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showRealTerms, setShowRealTerms] = useState(true);
  // The example the form was last filled from, while its values stand
  const [presetId, setPresetId] = useState(() => savedWizard.presetId ?? null);
  // The lifetime series for the policies selected in the title band
  const selectionKey = selectedPolicies.join(",");
  const selection = useMemo(
    () => lifecycleSelection(selectionKey ? selectionKey.split(",") : [], policies),
    [selectionKey, policies],
  );
  const activeReforms = selection.reforms;
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

  // Convert nominal value to 2026 prices
  const toRealTerms = useCallback(
    (value, year) => {
      if (!showRealTerms) return value;
      const inflationFactor = getCumulativeInflation(year);
      return value / inflationFactor;
    },
    [showRealTerms, getCumulativeInflation],
  );

  // Get display data with real terms conversion
  const displayData = useMemo(() => {
    if (!showRealTerms) return data;
    return data.map((row) => {
      const deflator = getCumulativeInflation(row.year);
      const adjusted = { ...row };
      REFORMS.forEach((r) => {
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
  }, [data, showRealTerms, getCumulativeInflation]);

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
        ...lifecycleInputs(inputs),
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

  // Debounced fetch when the lifecycle model's own inputs change
  const lifecycleKey = JSON.stringify(lifecycleInputs(inputs));
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycleKey]);

  // Handle input change
  const handleInputChange = (id, value) => {
    setPresetId(null);
    const numeric = SLIDER_CONFIGS.some((config) => config.id === id);
    setInputs((prev) => ({
      ...prev,
      [id]: numeric ? parseFloat(value) : value,
    }));
  };

  // Format signed currency
  // Tiles: one text colour; the sign is a true minus or a plus
  const formatTileCurrency = (v) => {
    const absVal = d3.format(",.0f")(Math.abs(v));
    return v < 0 ? `\u2212£${absVal}` : `+£${absVal}`;
  };

  const formatSignedCurrency = (v) => {
    const absVal = d3.format(",.0f")(Math.abs(v));
    return v >= 0 ? `+£${absVal}` : `-£${absVal}`;
  };

  // Format difference for modal tables
  const formatDiff = (diff) => {
    const sign = diff >= 0 ? "+" : "-";
    return `<span style="font-weight: 600;">${sign}£${d3.format(",.0f")(Math.abs(diff))}</span>`;
  };

  // Get RPI for a year
  const getRPI = (y) => RPI_FORECASTS[y] || RPI_LONG_TERM;

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
      const netImpact = posY + negY;
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

      const activeReforms = d.bars.filter((b) => b.value !== 0);
      if (activeReforms.length > 0) {
        html += `<div class="tooltip-section tooltip-reforms">`;
        activeReforms.forEach((bar) => {
          const reform = REFORMS.find((r) => r.key === bar.key);
          html += `<div class="tooltip-row">
            <span class="tooltip-label">${reform.label}</span>
            <span class="tooltip-value ${bar.value >= 0 ? "positive" : "negative"}">${formatSignedCurrency(bar.value)}</span>
          </div>`;
        });
        html += `</div>`;
      }

      const total = d3.sum(d.bars, (b) => b.value);
      html += `<div class="tooltip-row tooltip-total">
        <span>Net policy impact</span>
        <span class="tooltip-value ${total >= 0 ? "positive" : "negative"}">${formatSignedCurrency(total)}</span>
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
          clickedTab = REFORM_KEY_TO_TAB[bar.key] || "summary";
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
        .attr("fill", (d) => REFORMS.find((r) => r.key === d.key).color)
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
          .attr("fill", (d) => REFORMS.find((r) => r.key === d.key).color)
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
        .attr("fill", (d) => REFORMS.find((r) => r.key === d.key).color)
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
  }, [displayData, formatSignedCurrency, showModal, showRealTerms, activeReforms]);

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
          group: RAISER_KEYS.has(r.key) ? "raise" : "cost",
        })),
        { color: "#000000", label: "Net impact", type: "line" },
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
                { real: showRealTerms },
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
  }, [data.length, displayData, showRealTerms, activeReforms]);

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
    setInputs({ ...WIZARD_DEFAULTS, ...preset.inputs });
    setPresetId(preset.id);
  };
  const activePreset = YOUNG_PERSON_PRESETS.find((preset) => preset.id === presetId);

  const money = (value) => `£${d3.format(",.0f")(value)}`;
  const optionLabel = (id) =>
    SELECT_CONFIGS[id].options.find(([value]) => value === inputs[id])?.[1] ?? inputs[id];
  const inputSummary = [
    `Age ${inputs.current_age}, retiring at ${inputs.retirement_age}`,
    optionLabel("region"),
    `salary ${money(inputs.current_salary)}`,
    inputs.student_loan_plan === "NONE"
      ? "no student loan"
      : `${optionLabel("student_loan_plan")} loan ${money(inputs.student_loan_debt)}`,
    isRenting(inputs.tenure)
      ? `rent ${money(inputs.monthly_rent)} a month`
      : optionLabel("tenure").toLowerCase(),
    inputs.has_partner ? `partner on ${money(inputs.partner_salary)}` : "no partner",
    childrenCount === 0
      ? "no children"
      : `${childrenCount} ${childrenCount === 1 ? "child" : "children"}`,
  ].join(" · ");

  // The Single-year effect: asked for only while it is shown
  const householdPolicies = useMemo(
    () => (selectionKey ? selectionKey.split(",") : []),
    [selectionKey],
  );
  const householdResult = useHouseholdImpact({
    inputs,
    year,
    policies: householdPolicies,
    enabled: isResults && subTab === "single",
  });
  const noneSelected = householdPolicies.length === 0;

  // Whether a field applies to the answers so far (rent only when renting)
  const fieldApplies = (id) => !FIELD_APPLIES[id] || FIELD_APPLIES[id](inputs, childrenCount);

  // One question of the form
  const renderField = (id) => {
    if (!fieldApplies(id)) return null;
    if (id === "children_ages") {
      return (
        <div className="control-group" key={id}>
          <label htmlFor="field-children_ages">Children&apos;s ages</label>
          <div className="slider-container">
            <input
              id="field-children_ages"
              type="text"
              value={inputs.children_ages}
              placeholder="e.g. 5, 3, 1"
              className="text-input"
              aria-describedby="hint-children_ages"
              onChange={(e) => handleInputChange("children_ages", e.target.value)}
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
    if (SELECT_CONFIGS[id]) {
      const config = SELECT_CONFIGS[id];
      return (
        <div className="control-group" key={id}>
          <label htmlFor={`field-${id}`}>{config.label}</label>
          <div className="slider-container">
            <select
              id={`field-${id}`}
              className="select-input"
              value={inputs[id]}
              aria-describedby={`hint-${id}`}
              onChange={(e) => handleInputChange(id, e.target.value)}
            >
              {config.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p className="field-hint" id={`hint-${id}`}>
            {FIELD_HINTS[id]}
          </p>
        </div>
      );
    }
    if (CHECK_CONFIGS[id]) {
      return (
        <div className="control-group is-check" key={id}>
          <label htmlFor={`field-${id}`}>
            <input
              id={`field-${id}`}
              type="checkbox"
              checked={Boolean(inputs[id])}
              aria-describedby={`hint-${id}`}
              onChange={(e) => handleInputChange(id, e.target.checked)}
            />
            {CHECK_CONFIGS[id].label}
          </label>
          <p className="field-hint" id={`hint-${id}`}>
            {FIELD_HINTS[id]}
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
  };

  // Common table styling for modal
  const tableStyle = `width: 100%; border-collapse: collapse; font-size: 0.85rem;`;
  const thStyle = `padding: 10px 12px; text-align: right; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #1e293b;`;
  const tdStyle = `padding: 8px 12px; text-align: right; border-bottom: 1px solid #f1f5f9;`;
  const labelStyle = `padding: 8px 12px; text-align: left; border-bottom: 1px solid #f1f5f9; color: #64748b;`;

  // Render modal content based on active tab
  const renderModalContent = () => {
    if (!modalRow || !displayModalRow) return null;

    const row = modalRow;
    const displayRow = displayModalRow;
    const year = row.year;
    const termsSuffix = getTermsSuffix();

    // Build summary section
    let summaryHtml = `
      <div class="calc-section">
        <div class="calc-title">Income & deductions</div>
        <table class="calc-table">
          <tr><td>Gross income</td><td>£${d3.format(",.0f")(displayRow.gross_income)}</td></tr>
          <tr><td>Income tax</td><td>£${d3.format(",.0f")(displayRow.income_tax)}</td></tr>
          <tr><td>National insurance</td><td>£${d3.format(",.0f")(displayRow.national_insurance)}</td></tr>
          <tr><td>Student loan payment</td><td>£${d3.format(",.0f")(displayRow.student_loan_payment)}</td></tr>
          <tr><td>Student loan debt remaining</td><td>£${d3.format(",.0f")(displayRow.student_loan_debt_remaining)}</td></tr>
        </table>
      </div>
    `;

    REFORMS.forEach((r) => {
      const impact = displayRow[r.key] || 0;
      summaryHtml += `
        <div class="calc-section">
          <div class="calc-title"><span class="calc-dot" style="background:${r.color}"></span>${r.label}</div>
          <table class="calc-table">
            <tr><td>Year</td><td>${year}</td></tr>
            <tr class="calc-result ${impact >= 0 ? "positive" : "negative"}"><td>Impact</td><td>${formatSignedCurrency(impact)}</td></tr>
          </table>
        </div>
      `;
    });

    const netImpact = activeReforms.reduce((sum, r) => sum + (displayRow[r.key] || 0), 0);
    summaryHtml += `
      <div class="calc-section">
        <div class="calc-title">Net impact at age ${modalAge}</div>
        <table class="calc-table">
          <tr class="calc-result ${netImpact >= 0 ? "positive" : "negative"}"><td>Total</td><td>${formatSignedCurrency(netImpact)}</td></tr>
        </table>
      </div>
    `;

    // Render tab-specific content
    const renderTaxDetail = () => {
      const income = row.gross_income;
      if (!income || income === 0) {
        return '<div style="text-align: center; color: #64748b; padding: 40px;">No income at this age (retired)</div>';
      }
      if (year < 2028) {
        return `<div style="text-align: center; color: #64748b; padding: 40px;">
          <div style="font-size: 1.1rem; margin-bottom: 8px;">Policy not yet active</div>
          <div style="font-size: 0.85rem;">The threshold freeze extension takes effect from 2028 when the original freeze was due to end. In ${year}, both scenarios are identical.</div>
        </div>`;
      }

      const calcEffectivePA = (pa, taperThreshold) => {
        if (income > taperThreshold) {
          const reduction = Math.min(pa, (income - taperThreshold) * 0.5);
          return Math.max(0, pa - reduction);
        }
        return pa;
      };

      const baselineEffectivePA = calcEffectivePA(row.baseline_pa, row.baseline_taper_threshold || 100000);
      const reformEffectivePA = calcEffectivePA(row.reform_pa, row.reform_taper_threshold || 100000);

      const calcBands = (effectivePA, nominalPA, basicThreshold, additionalThreshold) => {
        let remaining = income;
        const taxFree = Math.min(remaining, effectivePA);
        remaining -= taxFree;
        const basicBand = Math.max(0, Math.min(remaining, basicThreshold - nominalPA));
        remaining -= basicBand;
        const higherBand = Math.max(0, Math.min(remaining, additionalThreshold - basicThreshold));
        remaining -= higherBand;
        const additionalBand = Math.max(0, remaining);
        const tax = basicBand * 0.2 + higherBand * 0.4 + additionalBand * 0.45;
        return { taxFree, basicBand, higherBand, additionalBand, tax };
      };

      const baselineBands = calcBands(baselineEffectivePA, row.baseline_pa, row.baseline_basic_threshold, row.baseline_additional_threshold || 125140);
      const reformBands = calcBands(reformEffectivePA, row.reform_pa, row.reform_basic_threshold, row.reform_additional_threshold || 125140);

      const allRows = [
        { section: "Policy parameters (affected by freeze)" },
        { label: "Personal allowance", preAB: row.baseline_pa, postAB: row.reform_pa },
        { label: "Basic rate threshold", preAB: row.baseline_basic_threshold, postAB: row.reform_basic_threshold },
        { section: "Tax calculation" },
        { label: "Effective personal allowance", preAB: baselineEffectivePA, postAB: reformEffectivePA },
        { label: "Income taxed at 0%", preAB: baselineBands.taxFree, postAB: reformBands.taxFree },
        { label: "Income taxed at 20%", preAB: baselineBands.basicBand, postAB: reformBands.basicBand },
        { label: "Income taxed at 40%", preAB: baselineBands.higherBand, postAB: reformBands.higherBand },
        { label: "Income taxed at 45%", preAB: baselineBands.additionalBand, postAB: reformBands.additionalBand },
        { separator: true },
        { label: "Total income tax", preAB: baselineBands.tax, postAB: reformBands.tax, highlight: true },
      ];

      return renderComparisonTable(allRows, year, `Gross income: £${d3.format(",.0f")(toRealTerms(income, year))}`,
        "Pre-AB, PA/basic thresholds would rise with CPI from 2028. Post-AB, they remain frozen until 2030-31.");
    };

    const renderStudentLoanDetail = () => {
      const income = row.gross_income;
      const yearsFromGrad = row.age - 22;

      if (year < 2027) {
        return `<div style="text-align: center; color: #64748b; padding: 40px;">
          <div style="font-size: 1.1rem; margin-bottom: 8px;">Policy not yet active</div>
          <div style="font-size: 0.85rem;">The student loan threshold freeze extension takes effect from 2027. In ${year}, both scenarios are identical.</div>
        </div>`;
      }

      const FORGIVENESS_YEARS = 30;
      const forgiven = yearsFromGrad >= FORGIVENESS_YEARS;

      const baselineThreshold = row.baseline_sl_threshold;
      const reformThreshold = row.reform_sl_threshold;
      const baselineRepayment = row.baseline_sl_payment || 0;
      const reformRepayment = row.reform_sl_payment || 0;
      const baselineDebt = row.baseline_sl_debt || 0;
      const reformDebt = row.reform_sl_debt || 0;

      const prevRow = data.find((d) => d.age === row.age - 1);
      const prevBaselineDebt = prevRow ? prevRow.baseline_sl_debt : inputs.student_loan_debt;
      const prevReformDebt = prevRow ? prevRow.reform_sl_debt : inputs.student_loan_debt;

      const rpi = getRPI(year);

      const allRows = [
        { section: "Policy parameters (affected by freeze)" },
        { label: "Repayment threshold", preAB: baselineThreshold, postAB: reformThreshold },
        { section: "Repayment calculation" },
        { label: "Income above threshold", preAB: Math.max(0, income - baselineThreshold), postAB: Math.max(0, income - reformThreshold) },
        { label: "Annual repayment (9%)", preAB: baselineRepayment, postAB: reformRepayment, highlight: true },
        { section: "Debt evolution this year" },
        { label: "Debt at start of year", preAB: prevBaselineDebt, postAB: prevReformDebt },
        { label: "− Repayment", preAB: baselineRepayment, postAB: reformRepayment },
        { label: "= After repayment", preAB: Math.max(0, prevBaselineDebt - baselineRepayment), postAB: Math.max(0, prevReformDebt - reformRepayment) },
        { separator: true },
        { label: "= Debt at end of year", preAB: baselineDebt, postAB: reformDebt, highlight: true },
      ];

      return renderComparisonTable(allRows, year,
        `Gross income: £${d3.format(",.0f")(toRealTerms(income, year))} | Years since graduation: ${yearsFromGrad}${forgiven ? " ✓ Debt forgiven" : ""}`,
        "Repayment = 9% × (income − threshold). Pre-AB, threshold rises with RPI. Post-AB, threshold frozen at £27,295 until 2030.");
    };

    const renderSalarySacrificeDetail = () => {
      const income = row.gross_income;
      if (!income || income === 0) {
        return '<div style="text-align: center; color: #64748b; padding: 40px;">No income at this age (retired)</div>';
      }
      if (year < 2029) {
        return `<div style="text-align: center; color: #64748b; padding: 40px;">
          <div style="font-size: 1.1rem; margin-bottom: 8px;">Policy not yet active</div>
          <div style="font-size: 0.85rem;">The salary sacrifice cap takes effect from April 2029. In ${year}, both scenarios are identical.</div>
        </div>`;
      }

      const salarySacrifice = inputs.salary_sacrifice_per_year;
      const postSSIncome = income;
      const preSSSalary = postSSIncome + salarySacrifice;
      const CAP = 2000;
      const ECONOMY_WIDE_HAIRCUT = 0.0016;
      const excess = Math.max(0, salarySacrifice - CAP);
      const haircutAmount = preSSSalary * ECONOMY_WIDE_HAIRCUT;

      const allRows = [
        { section: "Income breakdown" },
        { label: "Salary (before any pension)", preAB: preSSSalary, postAB: preSSSalary },
        { label: "− Employer NI haircut (0.16%)", preAB: 0, postAB: haircutAmount },
        { label: "− Salary sacrifice", preAB: salarySacrifice, postAB: Math.min(salarySacrifice, CAP) },
        { section: "Pension contributions" },
        { label: "Employer pension (salary sacrifice)", preAB: salarySacrifice, postAB: Math.min(salarySacrifice, CAP) },
        { label: "Employee pension contribution", preAB: 0, postAB: excess },
        { section: "Summary" },
        { label: "Impact", preAB: 0, postAB: displayRow.impact_salary_sacrifice_cap || 0, highlight: true },
      ];

      return renderComparisonTable(allRows, year,
        `Pre-SS salary: £${d3.format(",.0f")(toRealTerms(preSSSalary, year))} | Pension contribution: £${d3.format(",.0f")(salarySacrifice)}/yr`,
        "Pre-AB, all pension via salary sacrifice avoids NI. Post-AB (from April 2029), only the first £2,000 can use salary sacrifice.");
    };

    const renderRailFareDetail = () => {
      if (year < 2026) {
        return `<div style="text-align: center; color: #64748b; padding: 40px;">
          <div style="font-size: 1.1rem; margin-bottom: 8px;">Policy not yet active</div>
          <div style="font-size: 0.85rem;">The rail fare freeze takes effect from 2026. In ${year}, there is no impact.</div>
        </div>`;
      }

      const railSpendingBase = inputs.rail_spending_per_year;
      const baseYear = 2024;
      const RAIL_MARKUP = 0.01;

      const getFareIndex = (targetYear, freeze2026) => {
        let index = 1.0;
        for (let y = baseYear; y < targetYear; y++) {
          if (freeze2026 && y === 2025) continue;
          const rpi = getRPI(y);
          index *= 1 + rpi + RAIL_MARKUP;
        }
        return index;
      };

      const preAB_index = getFareIndex(year, false);
      const postAB_index = getFareIndex(year, true);
      const preAB_spending = railSpendingBase * preAB_index;
      const postAB_spending = railSpendingBase * postAB_index;
      const savings = preAB_spending - postAB_spending;

      const allRows = [
        { section: "Fare index calculation" },
        { label: "Your rail spending (2024)", preAB: railSpendingBase, postAB: railSpendingBase },
        { label: "Fare index (from 2024)", preAB: `${preAB_index.toFixed(3)}×`, postAB: `${postAB_index.toFixed(3)}×`, isText: true },
        { section: "Current year spending" },
        { label: `Rail spending (${year})`, preAB: preAB_spending, postAB: postAB_spending },
        { separator: true },
        { label: "Annual saving from freeze", preAB: 0, postAB: savings, highlight: true },
      ];

      return renderComparisonTable(allRows, year, null,
        "Rail fares normally rise by RPI + 1% annually. In 2026, the government froze fares at 2025 levels. After 2026, fares resume rising but from the lower frozen base.");
    };

    const renderFuelDutyDetail = () => {
      if (year < 2026) {
        return `<div style="text-align: center; color: #64748b; padding: 40px;">
          <div style="font-size: 1.1rem; margin-bottom: 8px;">Policy not yet active</div>
          <div style="font-size: 0.85rem;">Fuel duty changes take effect from 2026. In ${year}, there is no impact.</div>
        </div>`;
      }

      const petrolSpending = inputs.petrol_spending_per_year;
      const UNFROZEN_RATE = 58.0;
      const AVG_PRICE = 140;
      let reformRate = year === 2026 ? 54.37 : 57.95;

      const litres = petrolSpending / (AVG_PRICE / 100);
      const dutyUnfrozen = litres * (UNFROZEN_RATE / 100);
      const dutyReform = litres * (reformRate / 100);

      const allRows = [
        { section: "Fuel consumption" },
        { label: "Your annual petrol spending", preAB: petrolSpending, postAB: petrolSpending },
        { label: "Estimated litres purchased", preAB: litres.toFixed(0), postAB: litres.toFixed(0), isText: true },
        { section: "Fuel duty rates" },
        { label: "Fuel duty rate (p/litre)", preAB: UNFROZEN_RATE.toFixed(2) + "p", postAB: reformRate.toFixed(2) + "p", isText: true },
        { label: "Total duty paid", preAB: dutyUnfrozen, postAB: dutyReform },
        { section: "Summary" },
        { label: "Annual saving from lower duty", preAB: 0, postAB: displayRow.impact_fuel_duty_freeze || 0, highlight: true },
      ];

      return renderComparisonTable(allRows, year, null,
        "The government extended the 5p fuel duty cut to August 2026, then phased in increases. Compared to an unfrozen baseline of 58p/litre, this results in lower duty payments.");
    };

    const renderUnearnedIncomeDetail = () => {
      const income = row.gross_income;
      if (!income || income === 0) {
        return '<div style="text-align: center; color: #64748b; padding: 40px;">No income at this age (retired)</div>';
      }

      const dividends = inputs.dividends_per_year;
      const savingsInterest = inputs.savings_interest_per_year;
      const propertyIncome = inputs.property_income_per_year;
      const totalUnearned = dividends + savingsInterest + propertyIncome;

      if (totalUnearned === 0) {
        return '<div style="text-align: center; color: #64748b; padding: 40px;">No unearned income - set dividends, savings interest, or property income above to see impact</div>';
      }

      const baselinePA = row.baseline_pa;
      const reformPA = row.reform_pa;
      const baselineBasicThreshold = row.baseline_basic_threshold;
      const reformBasicThreshold = row.reform_basic_threshold;

      const calcUnearnedTax = (pa, basicThreshold, applyRateIncrease = false) => {
        const remainingPA = Math.max(0, pa - income);
        const totalIncome = income + totalUnearned;
        const isHigherRate = totalIncome > basicThreshold;

        const DIVIDEND_ALLOWANCE = 500;
        const SAVINGS_ALLOWANCE = isHigherRate ? 500 : 1000;

        const dividendRate = isHigherRate ? 0.3375 : 0.0875;
        const savingsRate = isHigherRate ? 0.4 : 0.2;
        const propertyRate = isHigherRate ? 0.4 : 0.2;

        const rateMultiplier = applyRateIncrease ? 1.05 : 1.0;

        let paUsed = 0;
        const savingsAfterPA = Math.max(0, savingsInterest - Math.max(0, remainingPA - paUsed));
        paUsed += Math.min(savingsInterest, Math.max(0, remainingPA - paUsed));
        const taxableSavings = Math.max(0, savingsAfterPA - SAVINGS_ALLOWANCE);

        const dividendsAfterPA = Math.max(0, dividends - Math.max(0, remainingPA - paUsed));
        paUsed += Math.min(dividends, Math.max(0, remainingPA - paUsed));
        const taxableDividends = Math.max(0, dividendsAfterPA - DIVIDEND_ALLOWANCE);

        const propertyAfterPA = Math.max(0, propertyIncome - Math.max(0, remainingPA - paUsed));
        const taxableProperty = propertyAfterPA;

        return {
          remainingPA,
          isHigherRate,
          taxableSavings,
          taxableDividends,
          taxableProperty,
          savingsTax: taxableSavings * savingsRate * rateMultiplier,
          dividendTax: taxableDividends * dividendRate * rateMultiplier,
          propertyTax: taxableProperty * propertyRate * rateMultiplier,
          totalTax: (taxableSavings * savingsRate + taxableDividends * dividendRate + taxableProperty * propertyRate) * rateMultiplier,
        };
      };

      const preAB = calcUnearnedTax(baselinePA, baselineBasicThreshold, false);
      const postAB = calcUnearnedTax(reformPA, reformBasicThreshold, true);

      const allRows = [
        { section: "Your income" },
        { label: "Earned income (employment/pension)", preAB: income, postAB: income },
        { label: "Personal allowance", preAB: baselinePA, postAB: reformPA },
        { label: "Remaining PA for unearned income", preAB: preAB.remainingPA, postAB: postAB.remainingPA },
        { section: "Unearned income" },
        { label: "Savings interest", preAB: savingsInterest, postAB: savingsInterest },
        { label: "Dividend income", preAB: dividends, postAB: dividends },
        { label: "Property income", preAB: propertyIncome, postAB: propertyIncome },
        { section: "Tax calculation" },
        { label: "Rate band", preAB: preAB.isHigherRate ? "Higher rate" : "Basic rate", postAB: postAB.isHigherRate ? "Higher rate" : "Basic rate", isText: true },
        { label: "Tax on savings", preAB: preAB.savingsTax, postAB: postAB.savingsTax },
        { label: "Tax on dividends", preAB: preAB.dividendTax, postAB: postAB.dividendTax },
        { label: "Tax on property", preAB: preAB.propertyTax, postAB: postAB.propertyTax },
        { separator: true },
        { label: "Total unearned income tax", preAB: preAB.totalTax, postAB: postAB.totalTax, highlight: true },
      ];

      return renderComparisonTable(allRows, year, null,
        "The Autumn Budget increased taxes on unearned income by 5% and froze the personal allowance. Your PA is first used by earned income; any remainder shelters unearned income.");
    };

    const renderTwoChildLimitDetail = () => {
      const childrenAges = parseChildrenAges(inputs.children_ages);
      if (childrenAges.length === 0) {
        return '<div style="text-align: center; color: #64748b; padding: 40px;">No children - add children ages above to see impact from two-child limit abolition</div>';
      }

      const impact = displayRow.impact_two_child_limit || 0;
      return `
        <div style="padding: 20px;">
          <div style="margin-bottom: 16px;">
            <div style="font-size: 1.1rem; font-weight: 600; color: #334155;">Two-child limit abolition${termsSuffix}</div>
            <div style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">Removal of the two-child benefit limit from April 2026</div>
          </div>
          <div class="calc-section">
            <table class="calc-table">
              <tr><td>Children</td><td>${childrenAges.length}</td></tr>
              <tr><td>Year</td><td>${year}</td></tr>
              <tr class="calc-result ${impact >= 0 ? "positive" : "negative"}"><td>Impact</td><td>${formatSignedCurrency(impact)}</td></tr>
            </table>
          </div>
          <div style="margin-top: 16px; font-size: 0.8rem; color: #64748b;">
            <strong>How it works:</strong> The two-child limit restricts child tax credit and universal credit child elements to the first two children. The abolition from April 2026 removes this cap, benefiting families with three or more children.
          </div>
        </div>
      `;
    };

    // Helper function to render comparison tables
    const renderComparisonTable = (allRows, year, subtitle, explanation) => {
      let tableHtml = `
        <table style="${tableStyle}">
          <thead>
            <tr>
              <th style="${thStyle} text-align: left; width: 50%;">Item</th>
              <th style="${thStyle} width: 16.67%;">Pre-AB${termsSuffix}</th>
              <th style="${thStyle} width: 16.67%;">Post-AB${termsSuffix}</th>
              <th style="${thStyle} width: 16.67%;">Difference</th>
            </tr>
          </thead>
          <tbody>
      `;

      allRows.forEach((r) => {
        if (r.section) {
          tableHtml += `<tr><td colspan="4" style="padding: 12px 8px 6px; font-weight: 600; font-size: 0.85rem; color: #475569; background: #f8fafc;">${r.section}</td></tr>`;
        } else if (r.separator) {
          tableHtml += `<tr><td colspan="4" style="padding: 4px;"></td></tr>`;
        } else if (r.isText) {
          tableHtml += `
            <tr>
              <td style="${labelStyle}">${r.label}</td>
              <td style="${tdStyle}">${r.preAB}</td>
              <td style="${tdStyle}">${r.postAB}</td>
              <td style="${tdStyle}">-</td>
            </tr>
          `;
        } else {
          const preABReal = toRealTerms(r.preAB, year);
          const postABReal = toRealTerms(r.postAB, year);
          const diff = postABReal - preABReal;
          const rowStyle = r.highlight ? "background: #fef2f2;" : "";
          tableHtml += `
            <tr style="${rowStyle}">
              <td style="${labelStyle} ${r.highlight ? "font-weight: 600; color: #1e293b;" : ""}">${r.label}</td>
              <td style="${tdStyle}">£${d3.format(",.0f")(preABReal)}</td>
              <td style="${tdStyle}">£${d3.format(",.0f")(postABReal)}</td>
              <td style="${tdStyle}">${formatDiff(diff)}</td>
            </tr>
          `;
        }
      });

      tableHtml += `</tbody></table>`;

      return `
        <div style="padding: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
              <span style="font-weight: 600; color: #1e293b;">Year ${year}${termsSuffix}</span>
              ${subtitle ? `<span style="color: #64748b; margin-left: 12px;">${subtitle}</span>` : ""}
            </div>
          </div>
          ${tableHtml}
          <div style="margin-top: 16px; font-size: 0.8rem; color: #64748b;">
            <strong>How it works:</strong> ${explanation}
          </div>
        </div>
      `;
    };

    // Get content for active tab
    const getTabContent = () => {
      switch (modalActiveTab) {
        case "summary":
          return summaryHtml;
        case "tax":
          return renderTaxDetail();
        case "student-loan":
          return renderStudentLoanDetail();
        case "salary-sacrifice":
          return renderSalarySacrificeDetail();
        case "rail-fare":
          return renderRailFareDetail();
        case "fuel-duty":
          return renderFuelDutyDetail();
        case "unearned-income":
          return renderUnearnedIncomeDetail();
        case "two-child-limit":
          return renderTwoChildLimitDetail();
        default:
          return summaryHtml;
      }
    };

    return getTabContent();
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
        title="Your household"
        subtitle="Answer a few questions to see how the selected policies change your household's net income."
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
                {subTab === "multi" && (
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
                )}
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
              {WIZARD_STEPS[step].fields.map(renderField)}
              {(WIZARD_STEPS[step].more ?? []).some((id) => fieldApplies(id)) && (
                <Disclosure inCard className="wizard-more" title="More details (optional)">
                  {WIZARD_STEPS[step].more.map(renderField)}
                </Disclosure>
              )}
            </div>
          )}

          {isResults && (
            <div className="wizard-results-tabs">
              <SubTabs
                tabs={PERSONAL_SUB_TABS}
                value={subTab}
                onChange={setSubTab}
                ariaLabel="Personal impact results"
                idPrefix={SUB_TAB_PREFIX}
              />
            </div>
          )}

          {isResults && subTab === "single" && (
            <SubTabPanel idPrefix={SUB_TAB_PREFIX} value="single" className="wizard-results">
              <SingleYearHeadline
                result={householdResult}
                year={year}
                policies={policies}
                noPolicies={noneSelected}
              />
            </SubTabPanel>
          )}

          {isResults && subTab === "multi" && (
            <SubTabPanel idPrefix={SUB_TAB_PREFIX} value="multi" className="wizard-results">
                <p className="personal-lede">
                  Your change in take-home pay over your working life. The lifetime
                  model does not use your region, home, loan plan, partner,
                  Universal Credit claim or the optional details.
                </p>
                {noPolicies && (
                  <p className="lifecycle-empty" role="status">
                    Select at least one policy in the bar above to see your
                    lifetime impact.
                  </p>
                )}

                {/* Headline figures, as on the other views: only with
                    results, never as £0 */}
                <div
                  className="stat-tiles-row lifecycle-summary"
                  style={{ "--stat-count": 2 }}
                  hidden={!showResults}
                >
                  <div className="stat-tile">
                    <p className="stat-value">{formatTileCurrency(summaryStats.netTotal)}</p>
                    <p className="stat-label">
                      Net lifetime impact{showRealTerms ? ` (${PRICE_LABEL})` : ""}
                    </p>
                  </div>
                  <div className="stat-tile">
                    <p className="stat-value">{formatTileCurrency(summaryStats.avgPerYear)}</p>
                    <p className="stat-label">
                      Average per year{showRealTerms ? ` (${PRICE_LABEL})` : ""}
                    </p>
                  </div>
                </div>

                {showResults && selection.partialCombined && (
                  <p className="lifecycle-note">
                    The lifetime model costs the dividend, savings and property
                    income tax increases together, so they are shown only when
                    all three are selected.
                  </p>
                )}
                {showResults && selection.unmodelled.length > 0 && (
                  <p className="lifecycle-note">
                    Not in the lifetime model: {selection.unmodelled.join(", ")}.
                  </p>
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
                        raises: RAISER_KEYS.has(r.key),
                      }))}
                      netLabel="Net impact"
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
            </SubTabPanel>
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

      {/* The Single-year effect's sections, below the form card */}
      {isResults && subTab === "single" && !noneSelected && (
        <div role="region" aria-labelledby={subTabId(SUB_TAB_PREFIX, "single")}>
          <SingleYearDetails
            result={householdResult}
            year={year}
            policies={policies}
            onShowMethod={onShowMethod}
          />
        </div>
      )}

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
                  { key: "tax", label: "Threshold freeze" },
                  { key: "student-loan", label: "Student loan" },
                  { key: "salary-sacrifice", label: "Salary sacrifice" },
                  { key: "rail-fare", label: "Rail fare" },
                  { key: "fuel-duty", label: "Fuel duty" },
                  { key: "unearned-income", label: "Unearned income" },
                  { key: "two-child-limit", label: "Two-child limit" },
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
              <div
                className="modal-panel"
                dangerouslySetInnerHTML={{ __html: renderModalContent() }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LifecycleCalculator;
