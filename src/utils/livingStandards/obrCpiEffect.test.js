import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_BUDGET,
  OBR_CPI_EFFECT_TITLE,
  clearObrCpiEffectCache,
  effectRows,
  loadObrCpiEffect,
  obrCpiEffectSentence,
  obrCpiEffectTitle,
  parseObrCpiEffect,
  ppAxis,
  ppText,
} from "./obrCpiEffect";
import { AB2025_CPI_EFFECT } from "./obrCpiEffect.fixture";

const copy = () => structuredClone(AB2025_CPI_EFFECT);
const years = (pairs) => pairs.map(([year, pp]) => ({ year, pp }));

describe("parseObrCpiEffect", () => {
  it("reads the Autumn Budget 2025 figures as a labelled earlier Budget", () => {
    const effect = parseObrCpiEffect(copy());
    expect(effect.previous).toBe(true);
    expect(effect.basis).toBe("fiscal_years");
    expect(effect.page).toBe(64);
    expect(effect.years.map((y) => y.year)).toEqual(["2025-26", "2026-27", "2027-28", "2028-29", "2029-30", "2030-31"]);
    expect(effect.measures.map((m) => m.name)).toEqual([
      "Energy bills package",
      "Fuel duty freeze extension",
      "Rail fares freeze",
      "Mileage-based charge on electric cars",
      "Output gap",
    ]);
    expect(effect.measures.find((m) => m.name === "Output gap").indirect).toBe(true);
  });

  it("refuses another Budget's file unless it says it is one", () => {
    const doc = copy();
    delete doc.previous_budget;
    expect(parseObrCpiEffect(doc)).toBeNull();
  });

  it("takes this Budget's file without the flag, as this Budget", () => {
    const doc = copy();
    doc.budget = CURRENT_BUDGET;
    delete doc.previous_budget;
    const effect = parseObrCpiEffect(doc);
    expect(effect.previous).toBe(false);
    expect(obrCpiEffectTitle(effect)).toBe(OBR_CPI_EFFECT_TITLE);
  });

  it("refuses anything malformed", () => {
    const cases = [
      null,
      { ...copy(), schema: "other" },
      { ...copy(), basis: "quarters" },
      { ...copy(), years: [] },
      { ...copy(), years: years([["2026", -0.4]]) }, // calendar year on a fiscal basis
      { ...copy(), years: years([["2026-27", "-0.4"]]) },
      { ...copy(), years: years([["2026-27", -0.4], ["2026-27", 0.1]]) },
    ];
    for (const doc of cases) expect(parseObrCpiEffect(doc)).toBeNull();
    // The outlook file, which a stubbed fetch may hand back for any URL
    expect(parseObrCpiEffect({ forecast: { sections: [] } })).toBeNull();
  });

  it("refuses measures that do not add up to the total", () => {
    const doc = copy();
    doc.by_measure[0].years[1].pp += 0.05;
    expect(parseObrCpiEffect(doc)).toBeNull();
  });

  it("refuses measures with other years than the total", () => {
    const doc = copy();
    doc.by_measure[0].years = doc.by_measure[0].years.slice(1);
    expect(parseObrCpiEffect(doc)).toBeNull();
  });

  it("takes a file with no breakdown by measure", () => {
    const doc = copy();
    delete doc.by_measure;
    expect(parseObrCpiEffect(doc).measures).toEqual([]);
  });
});

describe("obrCpiEffectTitle", () => {
  it("names an earlier Budget and its EFO", () => {
    expect(obrCpiEffectTitle(parseObrCpiEffect(copy()))).toBe(
      "Effect of the Budget's measures on CPI inflation, Autumn Budget 2025 (OBR, November 2025)",
    );
  });
});

describe("obrCpiEffectSentence", () => {
  it("states the Autumn Budget 2025 figures from the rounded data", () => {
    expect(obrCpiEffectSentence(parseObrCpiEffect(copy()).years)).toBe(
      "The OBR estimates the Budget's measures lower CPI inflation by 0.4 percentage points in 2026-27 and raise it by 0.1 points in each of the next two years.",
    );
  });

  it("names separate years, runs and a single effect", () => {
    expect(obrCpiEffectSentence(years([["2026-27", 0.21], ["2027-28", 0], ["2028-29", -0.1]]))).toBe(
      "The OBR estimates the Budget's measures raise CPI inflation by 0.2 percentage points in 2026-27 and lower it by 0.1 points in 2028-29.",
    );
    expect(obrCpiEffectSentence(years([["2026-27", -0.3], ["2027-28", -0.3], ["2028-29", -0.3]]))).toBe(
      "The OBR estimates the Budget's measures lower CPI inflation by 0.3 percentage points in each year from 2026-27 to 2028-29.",
    );
    expect(obrCpiEffectSentence(years([["2026", 1.04]]))).toBe(
      "The OBR estimates the Budget's measures raise CPI inflation by 1.0 percentage point in 2026.",
    );
  });

  it("says when no year's effect reaches 0.1 points", () => {
    expect(obrCpiEffectSentence(years([["2026-27", 0.04], ["2027-28", -0.02]]))).toBe(
      "The OBR estimates the Budget's measures change CPI inflation by less than 0.05 percentage points in every year from 2026-27 to 2027-28.",
    );
  });
});

describe("chart helpers", () => {
  it("signs points and shows no negative zero", () => {
    expect(ppText(-0.43)).toBe("-0.4");
    expect(ppText(0.09)).toBe("+0.1");
    expect(ppText(-0.003)).toBe("0.0");
  });

  it("steps the axis in tenths, through zero", () => {
    expect(ppAxis([-0.43, 0.14])).toEqual({ domain: [-0.5, 0.2], ticks: [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2] });
    expect(ppAxis([0.04])).toEqual({ domain: [0, 0.1], ticks: [0, 0.1] });
  });

  it("puts each measure beside the total, year by year", () => {
    const rows = effectRows(parseObrCpiEffect(copy()));
    expect(rows[1].year).toBe("2026-27");
    expect(rows[1].total).toBeCloseTo(-0.4296, 4);
    expect(rows[1].m0).toBeCloseTo(-0.2520, 4);
  });
});

describe("loadObrCpiEffect", () => {
  beforeEach(() => clearObrCpiEffectCache());

  it("draws nothing before the file is published", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    expect(await loadObrCpiEffect({ fetchImpl })).toEqual({ status: "none" });
    expect(fetchImpl.mock.calls[0][0]).toBe("/data/obr_cpi_policy_effect.json");
  });

  it("reads and checks the file once per page", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(copy()), { status: 200 }));
    const first = await loadObrCpiEffect({ fetchImpl });
    expect(first.status).toBe("ready");
    expect(await loadObrCpiEffect({ fetchImpl })).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("draws nothing for a file it cannot read", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await loadObrCpiEffect({ fetchImpl })).toEqual({ status: "none" });
  });
});
