import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ProgrammeTable, { breakdownSentence } from "./ProgrammeTable";
import { NET_LAYERS, layerRows, layersInUse } from "./netIncomeParts";
import { SWEEP_COMPONENTS, sweepChips } from "./sweepComponents";
import { CHART_COLOURS } from "../../utils/chartTheme";
import { GAS_STANDING_CHARGES_ID, SAVINGS_INCOME_RATES_ID, calculatorOnlyNote } from "../../utils/calculatorOnlyMeasures";
import {
  GROUPS,
  SINGLE_YEAR_METHOD,
  groupTotals,
  policyRows,
  programmeGroups,
  roundProgrammeGroups,
} from "../../utils/singleYear";

/**
 * Gas standing charges abolished in the household's results (#355): the
 * household API counts the gas bill change in net income, files it in the
 * programme table under a "bills" group of its own (an amount paid, so a
 * lower bill is a gain), and gives it a part of net income across
 * earnings.
 */

// Ofgem's typical 9,500 kWh, a full year: the bill falls by £17.73
const BILL_CHANGE = -17.73;

// The API's programmes, as normaliseHouseholdImpact gives them
const programmes = [
  { id: "employment_income", group: "income", label: "Employment income", before: 35000, after: 35000, change: 0, children: [] },
  { id: "income_tax", group: "tax", label: "Income Tax", before: 4486, after: 4486, change: 0, children: [] },
  {
    id: "gas_bill_change",
    group: "bills",
    label: "Gas bill change",
    note: "The change in the gas bill when the standing charge is recovered through the unit rate instead.",
    before: 0,
    after: BILL_CHANGE,
    change: BILL_CHANGE,
    children: [],
  },
];
const totals = { before: 30514, after: 30514 - BILL_CHANGE, change: -BILL_CHANGE };

const shownGroups = () => groupTotals(roundProgrammeGroups(programmeGroups(programmes), totals));

describe("the programme table's gas bill group", () => {
  it("is its own group, after the others, an amount paid", () => {
    expect(GROUPS.map((group) => group.id)).toEqual(["income", "tax", "benefit", "pension", "bills"]);
    expect(GROUPS.at(-1)).toMatchObject({ id: "bills", label: "Gas bill", color: CHART_COLOURS.netGasBill });
    const bills = programmeGroups(programmes).find((group) => group.id === "bills");
    // A fall in the bill is a gain, as a fall in a tax is; the row is only
    // the change, with no bill before it
    expect(bills.rows).toEqual([
      expect.objectContaining({ id: "gas_bill_change", label: "Gas bill change", changeOnly: true, change: -BILL_CHANGE }),
    ]);
    expect(bills.changeOnly).toBe(true);
    expect(programmeGroups(programmes).find((group) => group.id === "tax").changeOnly).toBe(false);
  });

  it("keeps the table adding up to net income", () => {
    const groups = shownGroups();
    const sum = (side) => groups.reduce((acc, group) => acc + group.shown[side], 0);
    expect(sum("before")).toBe(Math.round(totals.before));
    expect(sum("after")).toBe(Math.round(totals.after));
    expect(sum("change")).toBe(Math.round(totals.change));
  });

  it("says the gas bill falls, and that taxes and benefits are unchanged", () => {
    expect(breakdownSentence(shownGroups())).toBe("The gas bill falls by £18 a year; market income, taxes and benefits are unchanged.");
    const higher = programmes.map((row) => (row.id === "gas_bill_change" ? { ...row, after: 44.59, change: 44.59 } : row));
    const groups = groupTotals(
      roundProgrammeGroups(programmeGroups(higher), { before: 30514, after: 30514 - 44.59, change: -44.59 }),
    );
    expect(breakdownSentence(groups)).toBe("The gas bill rises by £45 a year; market income, taxes and benefits are unchanged.");
  });

  it("shows a dash before and the change after, for the group and its row", () => {
    render(<ProgrammeTable programmes={programmes} totals={totals} yearLabel="2028-29" />);
    const row = (name) => screen.getAllByRole("row").find((item) => within(item).queryByText(name, { exact: true }));
    for (const name of ["Gas bill", "Gas bill change"]) {
      const cells = within(row(name)).getAllByRole("cell").map((cell) => cell.textContent);
      expect(cells).toEqual(["—", "+£18", "+£18"]);
    }
  });
});

describe("the earnings chart's gas bill layer", () => {
  it("is a part of net income of its own, in its own colour", () => {
    expect(NET_LAYERS.find((layer) => layer.key === "gas_bill_change")).toEqual({
      key: "gas_bill_change",
      label: "Gas bill change",
      color: CHART_COLOURS.netGasBill,
    });
    // Before Other taxes, which takes the rest of net income
    const keys = NET_LAYERS.map((layer) => layer.key);
    expect(keys.indexOf("gas_bill_change")).toBe(keys.indexOf("other_taxes") - 1);
  });

  it("has its own Show: chip, on net income only", () => {
    const component = SWEEP_COMPONENTS.find((item) => item.net?.includes("gas_bill_change"));
    expect(component).toMatchObject({ key: "gas_bill", label: "Gas bill change", color: CHART_COLOURS.netGasBill, rate: null });
    const chip = sweepChips("net", new Set(["gas_bill_change"]), { label: "Net income", colour: CHART_COLOURS.net }).find(
      (item) => item.key === "gas_bill",
    );
    expect(chip).toMatchObject({ disabled: false, folded: false });
    const rateChip = sweepChips("rate", new Set(), { label: "Rate", colour: CHART_COLOURS.net }).find((item) => item.key === "gas_bill");
    expect(rateChip.disabled).toBe(true);
    expect(rateChip.tip).toBe("Does not change with salary");
  });

  it("moves net income after the policies by the change at every point", () => {
    const points = [
      { income: 0, before: 9000, after: 9017.73, change: 17.73 },
      { income: 50000, before: 39000, after: 39017.73, change: 17.73 },
    ];
    const part = (gas) => ({ employment_income: 0, other_income: 9000, gas_bill_change: gas });
    const netParts = { before: [part(0), part(0)], after: [part(17.73), part(17.73)] };
    const change = layerRows(points, netParts, "change");
    expect(change.map((row) => row.gas_bill_change)).toEqual([17.73, 17.73]);
    expect(layersInUse(change).map((layer) => layer.key)).toEqual(["gas_bill_change"]);
    expect(layersInUse(layerRows(points, netParts, "before")).map((layer) => layer.key)).not.toContain("gas_bill_change");
  });
});

describe("the split by policy's gas row", () => {
  const byPolicy = (row) => ({
    measures: [{ id: "fuel_duty_rise_deferral", name: "Fuel duty", change: 0, status: "not_affected" }, row],
    residual: 0,
  });
  const NOTE = "A change in the gas bill, not in a tax or benefit.";

  it("carries its note when it changes the household", () => {
    const bars = policyRows(
      byPolicy({ id: GAS_STANDING_CHARGES_ID, name: "Gas standing charges abolished", change: 17.73, status: "affected", note: NOTE, noteKind: "bill_change" }),
      17.73,
      [],
      2028,
    );
    expect(bars.rows).toEqual([expect.objectContaining({ id: GAS_STANDING_CHARGES_ID, name: "Gas standing charges abolished", rounded: 18 })]);
    expect(bars.notes).toEqual([{ id: GAS_STANDING_CHARGES_ID, name: "Gas standing charges abolished", kind: "bill_change", text: NOTE }]);
  });

  it("says why it is £0: a calculated zero at average use, no mains gas, Northern Ireland or before the start", () => {
    const reason = "£0, calculated: at the average gas use, 11,359 kWh a year, the bill neither rises nor falls.";
    const bars = policyRows(
      byPolicy({ id: GAS_STANDING_CHARGES_ID, name: "Gas standing charges abolished", change: 0, status: "not_affected", note: reason, noteKind: "bill_change" }),
      0,
      [],
      2028,
    );
    expect(bars.noEffectItems.find((item) => item.id === GAS_STANDING_CHARGES_ID)).toMatchObject({
      name: "Gas standing charges abolished",
      reason,
    });
    expect(bars.notes).toEqual([]);
  });
});

describe("what the result says the calculator adds", () => {
  it("names every calculator-only measure the request carries", () => {
    expect(calculatorOnlyNote([SAVINGS_INCOME_RATES_ID, GAS_STANDING_CHARGES_ID, "fuel_duty_rise_deferral"])).toBe(
      "Your change includes the savings income tax rise and the gas standing charge abolition, which the dots leave out.",
    );
    expect(calculatorOnlyNote([GAS_STANDING_CHARGES_ID])).toBe(
      "Your change includes the gas standing charge abolition, which the dots leave out.",
    );
    expect(calculatorOnlyNote(["fuel_duty_rise_deferral"])).toBeNull();
  });

  it("names the gas standing charge abolition in the method note", () => {
    const [, engine] = SINGLE_YEAR_METHOD.find(([title]) => title === "Engine and policies");
    expect(engine).toMatch(/savings income tax rise and the gas standing charge abolition, which the national figures leave out/);
  });
});
