import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseScatterCsv } from "../utils/householdScatter";

const HEADER =
  "reform_id,reform_name,year,income_band,change_band,change_band_upper,households,income_basis_year";
// Measure a changes no household's income in 2027 (every cell in the zero
// band) and some in 2028
const CSV = [
  HEADER,
  "a,Measure A,2027,20000.0,-1.0,1.0,151000.0,2027",
  "a,Measure A,2027,25000.0,-1.0,1.0,98000.0,2027",
  "a,Measure A,2028,20000.0,-150.0,-100.0,140000.0,2027",
  "a,Measure A,2028,25000.0,-1.0,1.0,98000.0,2027",
].join("\n");

vi.mock("../hooks/useHouseholdScatterData", () => ({
  useHouseholdScatterData: () => ({ status: "ready", rows: parseScatterCsv(CSV), error: null }),
}));
vi.mock("../utils/measureCatalogue", () => ({
  useMeasureCatalogue: () => ({ combinedId: null, byId: new Map() }),
}));

const { default: HouseholdScatter } = await import("./HouseholdScatter");

const POLICIES = [{ id: "a", name: "Measure A" }];

describe("HouseholdScatter with no change in household incomes", () => {
  it("shows the shared note, not a column of dots at £0, when every published cell is in the zero band", () => {
    render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2027} />);
    expect(screen.getByText("None of the selected policies changes household incomes in 2027-28.")).toBeTruthy();
    expect(screen.queryByLabelText("Key")).toBeNull();
  });

  it("draws the plot in a year the measure changes incomes", () => {
    render(<HouseholdScatter selectedPolicies={["a"]} policies={POLICIES} selectedYear={2028} />);
    expect(screen.queryByText(/None of the selected policies changes household incomes/)).toBeNull();
    expect(screen.getByLabelText("Key")).toBeTruthy();
  });
});
