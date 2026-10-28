import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ProgrammeTable, { policyCsvRows } from "./ProgrammeTable";
import { policyRows } from "../../utils/singleYear";

// A Plan 2 graduate in 2027-28 with one other measure that changes the
// household and one that does not
const DESCRIPTION = "Plan 2 threshold unfrozen (test)";
const policies = [
  { id: "plan_2_threshold_unfreeze", name: "Plan 2 student loan threshold unfrozen", description: DESCRIPTION },
  { id: "warm_home_discount_top_up", name: "Warm Home Discount top-up", description: "WHD (test)" },
  { id: "domestic_electricity_zero_vat", name: "Zero VAT on domestic electricity", description: "VAT (test)" },
];
const parameterTables = {
  schema: "uk-budget-dashboard/policy-parameters/v1",
  measures: {
    plan_2_threshold_unfreeze: {
      description: DESCRIPTION,
      display: "path",
      rows: [
        {
          label: "Plan 2 repayment threshold",
          unit: "gbp",
          primary: true,
          points: [{ key: "2027", year: 2027, before: 29385, after: 30267 }],
        },
      ],
    },
  },
};
const programmes = [
  { id: "employment_income", group: "income", label: "Employment income", before: 40960.04, after: 40960.04, change: 0 },
  { id: "student_loan_repayments", group: "tax", label: "Student loan repayments", before: 1041.75, after: 962.37, change: -79.38 },
  { id: "vat_change", group: "tax", label: "VAT", before: 0, after: -38.1, change: -38.1 },
];
const totals = { before: 39918.29, after: 40035.77, change: 117.48 };
const byPolicy = {
  measures: [
    { id: "domestic_electricity_zero_vat", name: "Zero VAT on domestic electricity", change: 38.1, status: "affected" },
    { id: "plan_2_threshold_unfreeze", name: "Plan 2 student loan threshold unfrozen", change: 79.38, status: "affected" },
    { id: "warm_home_discount_top_up", name: "Warm Home Discount top-up", change: 0, status: "not_affected" },
  ],
  residual: 0,
};

const renderTable = () => {
  const split = policyRows(byPolicy, totals.change, policies);
  return render(
    <ProgrammeTable
      programmes={programmes}
      totals={totals}
      bars={split.all}
      split={split}
      policies={policies}
      household={{ student_loan_plan: "PLAN_2", electricity_spending: 800 }}
      salaryUsed={40960.04}
      year={2027}
      yearLabel="2027-28"
      parameterTables={parameterTables}
    />,
  );
};

describe("the household table's policy tabs", () => {
  it("opens on the Summary, with a tab per policy that changes the household and the rest folded", () => {
    renderTable();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "By policy", "Zero VAT on domestic electricity", "Plan 2 student loan threshold unfrozen"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("+1 with no effect for you")).toBeInTheDocument();
    // Summary has a round icon as each policy tab does, the same compact size
    const icons = tabs.map((tab) => tab.querySelector(".mrl-icon.mrl-icon--compact"));
    expect(icons.every(Boolean)).toBe(true);
    expect(icons[0].querySelector("svg")).not.toBeNull();
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    // The Summary is today's table
    expect(screen.getByRole("rowheader", { name: "Net income" })).toBeInTheDocument();
  });

  it("walks through a policy's parameters, the household's steps and its effect, reconciled with the split", () => {
    renderTable();
    fireEvent.click(screen.getByRole("tab", { name: /Plan 2/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Plan 2 repayment threshold/ })).toHaveTextContent("£29,385£30,267+£882");
    expect(within(table).getByRole("row", { name: /Income above the threshold/ })).toHaveTextContent("£11,575£10,693−£882");
    expect(within(table).getByRole("row", { name: /Repayment \(9%/ })).toHaveTextContent("−£1,042−£963+£79");
    const effect = within(table).getByRole("row", { name: /Effect on your net income/ });
    expect(effect).toHaveClass("breakdown-effect-row");
    const split = policyRows(byPolicy, totals.change, policies);
    const rounded = split.all.find((row) => row.id === "plan_2_threshold_unfreeze").rounded;
    expect(effect).toHaveTextContent(`+£${rounded}`);
  });

  it("moves between tabs with the arrow keys, wrapping, and only the chosen tab in the Tab order", () => {
    renderTable();
    const summary = screen.getByRole("tab", { name: "Summary" });
    fireEvent.keyDown(summary, { key: "ArrowLeft" });
    const last = screen.getByRole("tab", { name: /Plan 2/ });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("tabindex", "0");
    expect(summary).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(summary, { key: "End" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "breakdown-panel-plan_2_threshold_unfreeze");
  });

  it("gives a policy without parameters only its effect, and a CSV of what its tab shows", () => {
    renderTable();
    fireEvent.click(screen.getByRole("tab", { name: /Zero VAT/ }));
    const table = screen.getByRole("table");
    expect(within(table).queryByText("What changes")).toBeNull();
    expect(within(table).getByRole("row", { name: /Effect on your net income/ })).toHaveTextContent("+£38");
  });

  it("writes a policy tab's CSV rows as the table shows them", () => {
    const rows = policyCsvRows({
      parameters: [{ kind: "parameter", id: "t", label: "Threshold", unit: "gbp", before: 29385, after: 30267 }],
      household: [{ kind: "input", id: "s", label: "Spending", before: 1200, after: 1200 }],
      effect: 79,
    });
    expect(rows).toEqual([
      { section: "What changes", item: "Threshold", before: "£29,385", after: "£30,267", change: "+£882" },
      { section: "For your household", item: "Spending", before: "£1,200", after: "£1,200", change: "" },
      { section: "Effect on your net income", item: "Effect on your net income", before: "", after: "", change: "+£79" },
    ]);
  });

  it("keeps the tab row while the split by policy loads, and says so quietly when it fails", () => {
    const { rerender } = render(
      <ProgrammeTable programmes={programmes} totals={totals} splitStatus="loading" policies={policies} year={2027} yearLabel="2027-28" parameterTables={parameterTables} />,
    );
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Summary"]);
    expect(screen.getByRole("status")).toHaveTextContent("Breakdown by policy loading…");
    // The Summary table is there meanwhile
    expect(screen.getByRole("rowheader", { name: "Net income" })).toBeInTheDocument();
    rerender(
      <ProgrammeTable programmes={programmes} totals={totals} splitStatus="error" policies={policies} year={2027} yearLabel="2027-28" parameterTables={parameterTables} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("The breakdown by policy is unavailable");
  });
});
