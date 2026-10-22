import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import WaterfallChart from "./WaterfallChart";
import DistributionalChart from "./DistributionalChart";
import EmploymentIncomeChart from "./EmploymentIncomeChart";
import EmploymentIncomeDiffChart from "./EmploymentIncomeDiffChart";
import HouseholdScatterTemplate from "./HouseholdScatterTemplate";
import OBRComparisonTable from "./OBRComparisonTable";
import { geographyFetch } from "../test/geographyFixture";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    // A fixed size, so the chart draws in jsdom
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 800, height: 500 }}>
        {cloneElement(children, { width: 800, height: 500 })}
      </div>
    ),
  };
});

vi.mock("../utils/downloadFile", () => ({
  downloadFile: vi.fn(),
  downloadSvg: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

// Invented figures for two years, never survey results.
const SELECTED = ["two_child_limit"];
const YEARS = ["2029", "2030"];

const waterfallRows = YEARS.flatMap((year) =>
  ["1", "2"].map((decile) => ({
    reform_id: "two_child_limit",
    year,
    decile,
    avg_change: year === "2029" ? "100" : "200",
  })),
);

const distributionalRows = YEARS.flatMap((year) =>
  ["1st", "2nd"].map((decile) => ({
    reform_id: "two_child_limit",
    reform_name: "2 child limit repeal",
    year,
    decile,
    value: year === "2029" ? "1.5" : "2.5",
  })),
);

const INCOME_CURVE = [
  "reform_id,reform_name,year,employment_income,baseline_net_income,reform_net_income",
  ...YEARS.flatMap((year) =>
    ["0", "50000"].map(
      (income) =>
        `two_child_limit,2 child limit repeal,${year},${income},${20000 + Number(income)},${20500 + Number(income)}`,
    ),
  ),
].join("\n");

const OBR_COMPARISON = [
  "reform_id,reform_name,year,policyengine_value,obr_static_value,obr_post_behavioural_value",
  "two_child_limit,2 child limit repeal,2029,-3.1,-3.0,-3.2",
  "two_child_limit,2 child limit repeal,2030,-3.4,-3.3,-3.5",
].join("\n");

const BUDGETARY_IMPACT = [
  "reform_id,reform_name,year,value",
  "two_child_limit,2 child limit repeal,2029,-3.1",
  "two_child_limit,2 child limit repeal,2030,-3.4",
].join("\n");

const yearControl = (card) =>
  within(card).getByRole("button", { name: /^Year, / });

function chooseYear(card, yearLabel) {
  fireEvent.click(yearControl(card));
  fireEvent.click(within(card).getByRole("option", { name: yearLabel }));
}

const cardTitle = (card) =>
  within(card).getAllByRole("heading", { level: 3 })[0];

describe("each chart has its own year control", () => {
  it("the decile charts start at 2029-30 and change year independently", () => {
    const { container } = render(
      <div>
        <WaterfallChart rawData={waterfallRows} selectedPolicies={SELECTED} />
        <DistributionalChart
          rawData={distributionalRows}
          selectedPolicies={SELECTED}
        />
      </div>,
    );
    const waterfall = container.querySelector(".waterfall-chart");
    const distributional = container.querySelector(".distributional-chart");
    expect(yearControl(waterfall)).toHaveAccessibleName("Year, 2029-30");
    expect(yearControl(distributional)).toHaveAccessibleName("Year, 2029-30");

    chooseYear(waterfall, "2030-31");

    expect(cardTitle(waterfall)).toHaveTextContent("2030-31");
    expect(cardTitle(distributional)).toHaveTextContent("2029-30");
    expect(yearControl(distributional)).toHaveAccessibleName("Year, 2029-30");
  });

  it("a chart can start at a given year", () => {
    const { container } = render(
      <WaterfallChart
        rawData={waterfallRows}
        selectedPolicies={SELECTED}
        initialYear={2030}
      />,
    );
    expect(yearControl(container)).toHaveAccessibleName("Year, 2030-31");
    expect(cardTitle(container)).toHaveTextContent("2030-31");
  });

  it("the example household charts change year independently", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/income_curve.csv": INCOME_CURVE }),
    );
    const { container } = render(
      <div>
        <EmploymentIncomeChart selectedPolicies={SELECTED} />
        <EmploymentIncomeDiffChart selectedPolicies={SELECTED} />
      </div>,
    );
    const income = container.querySelector(".employment-income-chart");
    const change = container.querySelector(".employment-income-diff-chart");
    await waitFor(() => {
      expect(yearControl(income)).toHaveAccessibleName("Year, 2029-30");
      expect(yearControl(change)).toHaveAccessibleName("Year, 2029-30");
    });

    chooseYear(change, "2030-31");

    expect(cardTitle(change)).toHaveTextContent("2030-31");
    expect(cardTitle(income)).toHaveTextContent("2029-30");
  });

  it("the household scatter template's year control is visible to everyone", () => {
    const { container } = render(<HouseholdScatterTemplate />);
    expect(container.querySelector(".chart-controls")).not.toHaveAttribute(
      "aria-hidden",
    );
    expect(yearControl(container)).toHaveAccessibleName("Year, 2029-30");

    chooseYear(container, "2030-31");

    expect(cardTitle(container)).toHaveTextContent("2030-31");
  });

  it("the OBR comparison chart has its own year control", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(
      <OBRComparisonTable selectedPolicies={SELECTED} />,
    );
    expect(
      await screen.findByRole("button", { name: "Year, 2029-30" }),
    ).toBeInTheDocument();

    chooseYear(container, "2030-31");

    expect(
      screen.getByRole("heading", { level: 3, name: /PolicyEngine and OBR/ }),
    ).toHaveTextContent("2030-31");
  });
});
