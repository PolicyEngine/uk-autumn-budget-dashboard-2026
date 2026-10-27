import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FrozenThresholdsCard, { FROZEN_THRESHOLDS_TITLE } from "./FrozenThresholdsCard";
import { resetPolicyParameters } from "../../utils/policyParameters";
import { earningsIndex, indexAxis, thresholdRows, thresholdsSentence } from "../../utils/livingStandards/frozenThresholds";

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

  it("indexes the current-law thresholds and earnings to 2026-27, ending with the earnings forecast", () => {
    const rows = thresholdRows(PARAMETERS, OUTLOOK);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(rows[0]).toEqual({ year: 2026, earnings: 100, personal_allowance: 100, higher_rate: 100, plan_2: 100 });
    const last = rows.at(-1);
    expect(last.personal_allowance).toBe(100);
    expect(last.higher_rate).toBe(100);
    // Plan 2 is uprated from April 2030 under current law
    expect(last.plan_2).toBeCloseTo((100 * 30060.868375) / 29385, 9);
    expect(last.earnings).toBeCloseTo(100 * 1.024 * 1.021 * 1.022 * 1.024, 9);
  });

  it("says earnings' rise against the frozen thresholds in one sentence", () => {
    expect(thresholdsSentence(thresholdRows(PARAMETERS, OUTLOOK))).toBe(
      "By 2030-31 average earnings are 9.4% higher than in 2026-27, while the personal allowance and higher rate threshold are unchanged.",
    );
  });

  it("is null without a threshold entry", () => {
    const { threshold_freeze_2031_32: _, ...measures } = PARAMETERS.measures;
    expect(thresholdRows({ ...PARAMETERS, measures }, OUTLOOK)).toBeNull();
    expect(thresholdRows(PARAMETERS, null)).toBeNull();
  });

  it("puts the axis on whole steps around 100", () => {
    expect(indexAxis([100, 102.3, 109.4])).toEqual({ domain: [98, 110], ticks: [98, 100, 102, 104, 106, 108, 110] });
  });
});

describe("Frozen thresholds against pay: card", () => {
  it("shows the title, the sentence and a chip per line", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    expect(await screen.findByText(/^By 2030-31 average earnings are 9\.4% higher/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: FROZEN_THRESHOLDS_TITLE })).toBeTruthy();
    for (const name of ["Personal allowance", "Higher rate threshold", "Plan 2 student loan threshold", "Average earnings"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    // The pound values live on Policies: the card links there, not repeats them
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(document.body.textContent).not.toMatch(/£12,570|£50,270|£29,385/);
    expect(screen.getByRole("link", { name: "Policies" }).getAttribute("href")).toBe("?tab=policies");
  });

  it("table view lists each fiscal year's index", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} view="table" onViewChange={() => {}} />);
    await screen.findByText(/^By 2030-31/);
    const last = [...document.querySelectorAll(".ls-table tbody tr")].at(-1);
    expect([...last.cells].map((c) => c.textContent)).toEqual(["2030-31", "100.0", "100.0", "102.3", "109.4"]);
  });

  it("says the 2031-32 freeze year is not shown", async () => {
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    await screen.findByText(/^By 2030-31/);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(document.body.textContent).toMatch(/earnings forecast ends in 2030, so the chart ends in 2030-31; 2031-32/);
  });

  it("holds its place when the thresholds file is missing", async () => {
    serve(null);
    render(<FrozenThresholdsCard data={OUTLOOK} />);
    expect(await screen.findByText("The threshold values are not available.")).toBeTruthy();
  });
});
