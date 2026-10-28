import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FrozenThresholdsCard, { FROZEN_THRESHOLDS_TITLE } from "./FrozenThresholdsCard";
import { resetPolicyParameters } from "../../utils/policyParameters";
import { earningsGrowth, earningsIndex, relativeAxis, sameThresholds, thresholdRows, thresholdsSentence } from "../../utils/livingStandards/frozenThresholds";

// The props the card gives its line chart, to check what it asks it to draw
const chartProps = vi.hoisted(() => []);
vi.mock("./LsCharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    LsLineChart: (props) => {
      chartProps.push(props);
      return actual.LsLineChart(props);
    },
  };
});

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "data");
const read = (name) => JSON.parse(readFileSync(join(PUBLIC, name), "utf8"));
// The published current-law thresholds; earnings is the OBR October 2026
// growth the runs use (src/uk_budget_data/forecast/obr_october_2026.json)
const PARAMETERS = read("policy_parameters.json");
const OUTLOOK = read("living_standards_outlook.json");
// Table A.1's average earnings growth, calendar 2027 to 2031
const OCTOBER = { 2027: 0.03, 2028: 0.022, 2029: 0.023, 2030: 0.025, 2031: 0.026 };
const EARNINGS_2031 = 100 * 1.03 * 1.022 * 1.023 * 1.025 * 1.026;

const serve = (body) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body ? JSON.stringify(body) : "", { status: body ? 200 : 404 })));

beforeEach(() => {
  resetPolicyParameters();
  serve(PARAMETERS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Frozen thresholds against pay: data", () => {
  it("chains calendar-year growth onto the fiscal year starting in it, from 2026-27 = 100", () => {
    const index = earningsIndex({ 2027: 0.024, 2028: 0.021, 2029: 0.022, 2030: 0.024 });
    expect(index[2026]).toBe(100);
    expect(index[2027]).toBeCloseTo(102.4, 9);
    expect(index[2028]).toBeCloseTo(102.4 * 1.021, 9);
    expect(index[2030]).toBeCloseTo(100 * 1.024 * 1.021 * 1.022 * 1.024, 9);
    expect(index[2031]).toBeUndefined();
  });

  it("reads the October 2026 earnings growth the runs use", () => {
    expect(earningsGrowth()).toMatchObject(OCTOBER);
  });

  it("puts each current-law threshold relative to average earnings, 2026-27 = 100, ending with the earnings forecast", () => {
    const rows = thresholdRows(PARAMETERS);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(rows[0]).toEqual({ year: 2026, earnings: 100, personal_allowance: 100, higher_rate: 100, plan_2: 100 });
    const frozen = rows.find((r) => r.year === 2030);
    const earnings = 100 * 1.03 * 1.022 * 1.023 * 1.025;
    expect(frozen.earnings).toBeCloseTo(earnings, 9);
    // Frozen: 100 / the earnings index
    expect(frozen.personal_allowance).toBeCloseTo((100 * 100) / earnings, 9);
    expect(frozen.higher_rate).toBe(frozen.personal_allowance);
    const last = rows.at(-1);
    expect(last.earnings).toBeCloseTo(EARNINGS_2031, 9);
    // Plan 2 is uprated from April 2030 under current law (RPI, as the
    // engine projects it: read from the file's current_law block)
    const plan2 = Object.fromEntries(
      PARAMETERS.current_law.rows.find((r) => r.label === "Plan 2 repayment threshold").points.map((p) => [p.year, p.before]),
    );
    expect(plan2[2026]).toBe(29385);
    expect(plan2[2030]).toBeGreaterThan(29385);
    expect(frozen.plan_2).toBeCloseTo((100 * ((100 * plan2[2030]) / plan2[2026])) / earnings, 9);
  });

  it("draws one line for the two income tax thresholds only while they are equal", () => {
    const rows = thresholdRows(PARAMETERS).filter((r) => r.year <= 2030);
    expect(sameThresholds(rows)).toBe(true);
    expect(sameThresholds(rows.map((r, i) => (i === 2 ? { ...r, higher_rate: r.higher_rate + 1 } : r)))).toBe(false);
  });

  it("says what the income tax thresholds are worth against earnings in one sentence", () => {
    const rows = thresholdRows(PARAMETERS).filter((r) => r.year <= 2030);
    expect(thresholdsSentence(rows)).toBe(
      "By 2030-31 the personal allowance and higher rate threshold are worth 9.4% less relative to average earnings than in 2026-27.",
    );
    const apart = rows.map((r) => ({ ...r, higher_rate: 100 }));
    expect(thresholdsSentence(apart)).toBe(
      "By 2030-31 the personal allowance is worth 9.4% less and the higher rate threshold 0.0% more relative to average earnings than in 2026-27.",
    );
  });

  it("is null without a threshold entry", () => {
    const { current_law: _, ...withoutCurrentLaw } = PARAMETERS;
    expect(thresholdRows(withoutCurrentLaw)).toBeNull();
    // Measures' rows are never read for current law
    expect(thresholdRows({ ...withoutCurrentLaw, measures: { x: { rows: PARAMETERS.current_law.rows } } })).toBeNull();
    expect(thresholdRows(PARAMETERS, null)).toBeNull();
  });

  it("fits the axis to the gaps from 100, with room above the reference line", () => {
    const { domain, ticks } = relativeAxis([100, 93.5, 91.4]);
    expect(domain[0]).toBeLessThanOrEqual(91.4);
    expect(domain[1]).toBeGreaterThan(100);
    expect(ticks).toContain(100);
  });
});

describe("Frozen thresholds against pay: card", () => {
  it("shows the title, the sentence and a chip per line", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    expect(await screen.findByText(/^By 2031-32 the personal allowance is worth 9\.9% less and the higher rate threshold 9\.8% less/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: FROZEN_THRESHOLDS_TITLE })).toBeTruthy();
    // Uprated apart in 2031-32, so a line each
    for (const name of ["Personal allowance", "Higher rate threshold", "Plan 2 student loan threshold", "Keeps pace with pay"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    // Index values only: no pound values, and no pointer to Policies, which
    // lists no threshold now that no measure changes one
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(document.body.textContent).not.toMatch(/£12,570|£50,270|£29,385/);
    expect(screen.queryByRole("link", { name: "Policies" })).toBeNull();
  });

  it("keys the lines by its chips alone: no end labels, no legend", async () => {
    chartProps.length = 0;
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    await screen.findByText(/^By 2031-32 the personal allowance/);
    const props = chartProps.at(-1);
    expect(props.endLabels ?? false).toBe(false);
    expect(props.legend).toBe(false);
    expect(props.keyContent).toBeTruthy();
    expect(props.series.every((s) => s.endLabel === undefined)).toBe(true);
    expect(document.querySelector(".ls-end-labels")).toBeNull();
  });

  it("table view lists earnings' index and each threshold relative to it", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} view="table" onViewChange={() => {}} />);
    await screen.findByText(/^By 2031-32/);
    const last = [...document.querySelectorAll(".ls-table tbody tr")].at(-1);
    expect([...last.cells].map((c) => c.textContent)).toEqual(["2031-32", "113.2", "90.1", "90.2", "92.3"]);
  });

  it("names the October 2026 forecast it ends with", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    await screen.findByText(/^By 2031-32/);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(document.body.textContent).toMatch(/The OBR's October 2026 earnings forecast ends in 2031, so the chart ends in 2031-32\./);
    expect(document.body.textContent).not.toMatch(/March 2026|before the Autumn Budget/);
    expect(document.body.textContent).not.toMatch(/candidate measure/);
  });

  it("holds its place when the thresholds file is missing", async () => {
    serve(null);
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    expect(await screen.findByText("The threshold values are not available.")).toBeTruthy();
  });
});
