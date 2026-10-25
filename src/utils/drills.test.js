import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CURRENT_SCENARIO,
  DRILLS,
  OUTPUTS,
  SCENARIO_OPTIONS,
  scenarioDataDir,
  scenarioFromSearch,
  scenarioHas,
} from "./drills";
import { ALL_MEASURE_NAMES, POLICY_COLORS, POLICY_ICONS, REVENUE_RAISING_NAMES } from "./policyConfig";

describe("drill scenarios", () => {
  it("offers Current first, then the four drills", () => {
    expect(SCENARIO_OPTIONS.map((option) => option.label)).toEqual([
      "Current",
      "Drill 1",
      "Drill 2",
      "Drill 3",
      "Drill 4",
    ]);
  });

  it("reads ?scenario=, falling back to Current", () => {
    expect(scenarioFromSearch("?scenario=drill2")).toBe("drill2");
    expect(scenarioFromSearch("?scenario=drill9")).toBe(CURRENT_SCENARIO);
    expect(scenarioFromSearch("")).toBe(CURRENT_SCENARIO);
  });

  it("reads Current from public/data and a drill from its own folder", () => {
    expect(scenarioDataDir(CURRENT_SCENARIO)).toBe("/data");
    expect(scenarioDataDir("drill3")).toBe("/data/drills/drill3");
  });

  it("gives Current every section and a drill only what it calculated", () => {
    Object.values(OUTPUTS).forEach((output) => {
      expect(scenarioHas(CURRENT_SCENARIO, output)).toBe(true);
    });
    expect(scenarioHas("drill1", OUTPUTS.young)).toBe(false);
    expect(scenarioHas("drill4", OUTPUTS.map)).toBe(true);
  });

  it("colours, icons and orders every drill measure", () => {
    DRILLS.flatMap((drill) => drill.measures).forEach((measure) => {
      expect(POLICY_COLORS[measure.name]).toMatch(/^#[0-9A-F]{6}$/);
      expect(POLICY_ICONS[measure.id]).toBeTruthy();
      expect(ALL_MEASURE_NAMES).toContain(measure.name);
      expect(REVENUE_RAISING_NAMES.has(measure.name)).toBe(measure.raises);
    });
  });

  it("lists exactly the measures in each drill's revenue file", () => {
    DRILLS.forEach((drill) => {
      const csv = readFileSync(`public/data/drills/${drill.id}/budgetary_impact.csv`, "utf8");
      const ids = new Set(csv.trim().split("\n").slice(1).map((line) => line.split(",")[0]));
      expect(ids).toEqual(new Set(drill.measures.map((measure) => measure.id)));
    });
  });
});
