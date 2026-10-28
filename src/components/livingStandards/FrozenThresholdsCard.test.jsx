import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FrozenThresholdsCard, { FROZEN_THRESHOLDS_TITLE } from "./FrozenThresholdsCard";
import { resetPolicyParameters } from "../../utils/policyParameters";
import { earningsIndex, relativeAxis, sameThresholds, thresholdRows, thresholdsSentence } from "../../utils/livingStandards/frozenThresholds";

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
// The published files: the current-law thresholds and the OBR earnings growth
const PARAMETERS = read("policy_parameters.json");
const OUTLOOK = read("living_standards_outlook.json");

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

  it("puts each current-law threshold relative to average earnings, 2026-27 = 100, ending with the earnings forecast", () => {
    const rows = thresholdRows(PARAMETERS, OUTLOOK);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(rows[0]).toEqual({ year: 2026, earnings: 100, personal_allowance: 100, higher_rate: 100, plan_2: 100 });
    const last = rows.at(-1);
    const earnings = 100 * 1.024 * 1.021 * 1.022 * 1.024;
    expect(last.earnings).toBeCloseTo(earnings, 9);
    // Frozen: 100 / the earnings index
    expect(last.personal_allowance).toBeCloseTo((100 * 100) / earnings, 9);
    expect(last.higher_rate).toBe(last.personal_allowance);
    // Plan 2 is uprated from April 2030 under current law
    expect(last.plan_2).toBeCloseTo((100 * ((100 * 30060.868375) / 29385)) / earnings, 9);
  });

  it("draws one line for the two income tax thresholds only while they are equal", () => {
    const rows = thresholdRows(PARAMETERS, OUTLOOK);
    expect(sameThresholds(rows)).toBe(true);
    expect(sameThresholds(rows.map((r, i) => (i === 2 ? { ...r, higher_rate: r.higher_rate + 1 } : r)))).toBe(false);
  });

  it("says what the income tax thresholds are worth against earnings in one sentence", () => {
    const rows = thresholdRows(PARAMETERS, OUTLOOK);
    expect(thresholdsSentence(rows)).toBe(
      "By 2030-31 the personal allowance and higher rate threshold are worth 8.6% less relative to average earnings than in 2026-27.",
    );
    const apart = rows.map((r) => ({ ...r, higher_rate: 100 }));
    expect(thresholdsSentence(apart)).toBe(
      "By 2030-31 the personal allowance is worth 8.6% less and the higher rate threshold 0.0% more relative to average earnings than in 2026-27.",
    );
  });

  it("is null without a threshold entry", () => {
    const { current_law: _, ...withoutCurrentLaw } = PARAMETERS;
    expect(thresholdRows(withoutCurrentLaw, OUTLOOK)).toBeNull();
    // Measures' rows are never read for current law
    expect(thresholdRows({ ...withoutCurrentLaw, measures: { x: { rows: PARAMETERS.current_law.rows } } }, OUTLOOK)).toBeNull();
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
    expect(await screen.findByText(/^By 2030-31 the personal allowance and higher rate threshold are worth 8\.6% less/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: FROZEN_THRESHOLDS_TITLE })).toBeTruthy();
    for (const name of ["Personal allowance and higher rate threshold", "Plan 2 student loan threshold", "Keeps pace with pay"]) {
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
    await screen.findByText(/^By 2030-31 the personal allowance/);
    const props = chartProps.at(-1);
    expect(props.endLabels ?? false).toBe(false);
    expect(props.legend).toBe(false);
    expect(props.keyContent).toBeTruthy();
    expect(props.series.every((s) => s.endLabel === undefined)).toBe(true);
    expect(document.querySelector(".ls-end-labels")).toBeNull();
  });

  it("table view lists earnings' index and each threshold relative to it", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} view="table" onViewChange={() => {}} />);
    await screen.findByText(/^By 2030-31/);
    const last = [...document.querySelectorAll(".ls-table tbody tr")].at(-1);
    expect([...last.cells].map((c) => c.textContent)).toEqual(["2030-31", "109.4", "91.4", "93.5"]);
  });

  it("says 2031-32, when current law uprates the thresholds again, is not shown", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    await screen.findByText(/^By 2030-31/);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(document.body.textContent).toMatch(/earnings forecast ends in 2030, so the chart ends in 2030-31; 2031-32, when current law uprates the thresholds again, is not shown\./);
    expect(document.body.textContent).not.toMatch(/candidate measure/);
  });

  it("holds its place when the thresholds file is missing", async () => {
    serve(null);
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    expect(await screen.findByText("The threshold values are not available.")).toBeTruthy();
  });
});
