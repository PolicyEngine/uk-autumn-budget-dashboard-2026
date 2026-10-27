// Household calculator's "Average for your income tenth" reads the verified
// artifacts' decile rows, as the tenths' chart does, never the root
// distributional_impact.csv, which holds an older run (#228).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildMeasureCatalogue } from "../../utils/measureCatalogue";
import { fixtureJson } from "../../test/publicationFixture";

const YEARS = [2026, 2027, 2028];
const DECILES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const manifestFixture = fixtureJson("manifest.json");

// Percentile p has an equivalised income of £1,000 × p on both sides
const DISTRIBUTION = ["baseline", "reform"].flatMap((side) =>
  Array.from({ length: 99 }, (_, i) => ({ reformId: "alpha", year: 2027, side, percentile: i + 1, income: (i + 1) * 1000 })),
);
// The root file's older run: never read
const ROOT_RELATIVE = DECILES.map((decile) => ({ reform_id: "alpha", year: "2027", decile, value: "9.99" }));

const files = vi.hoisted(() => ({ current: {} }));
vi.mock("../../hooks/useDataFile", () => ({
  default: (name) => files.current[name] ?? { status: "error", rows: null },
}));
const catalogueRef = vi.hoisted(() => ({ current: null }));
vi.mock("../../utils/measureCatalogue", async (importOriginal) => ({
  ...(await importOriginal()),
  useMeasureCatalogue: () => catalogueRef.current,
}));

const { ResultTiles } = await import("./IncomePositionChart");

function catalogue(tables) {
  const entry = manifestFixture.measures.alpha;
  return buildMeasureCatalogue({
    manifest: { ...manifestFixture, measures: { alpha: { ...entry, name: "alpha", status: "provisional", years: YEARS, unsupported_years: [] } }, combined: {} },
    tablesByKey: { alpha: tables },
  });
}

function show() {
  // £25,500 a year for a couple (factor 1): the 25th percentile, the 3rd tenth
  render(
    <ResultTiles
      totals={{ before: 25000, after: 25500, change: 500 }}
      changeValue="£500"
      changeNote="2027-28"
      household={{ has_partner: true, children: [] }}
      year={2027}
      policies={["alpha"]}
    />,
  );
}

describe("ResultTiles' average for your income tenth", () => {
  it("is the verified artifact's row, not the root file's", () => {
    files.current = {
      "income_distribution.csv": { status: "ready", rows: DISTRIBUTION },
      "distributional_impact.csv": { status: "ready", rows: ROOT_RELATIVE },
    };
    catalogueRef.current = catalogue({
      distributional_impact: DECILES.map((decile, i) => ({ reform_id: "alpha", year: 2027, decile, value: (i + 1) / 10 })),
    });
    show();
    expect(screen.getByText("Average for your income tenth: +0.30%")).toBeTruthy();
    expect(screen.queryByText(/9\.99/)).toBeNull();
  });

  it("is not published when the verified artifacts have no decile rows, whatever the root file holds", () => {
    files.current = {
      "income_distribution.csv": { status: "ready", rows: DISTRIBUTION },
      "distributional_impact.csv": { status: "ready", rows: ROOT_RELATIVE },
    };
    catalogueRef.current = catalogue({});
    show();
    expect(screen.getByText("Your tenth's average is not published")).toBeTruthy();
  });

  it("says in the Your place tile, in one muted line, why there is no place", () => {
    files.current = { "income_distribution.csv": { status: "ready", rows: [] } };
    catalogueRef.current = catalogue({});
    show();
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(document.querySelector(".result-tile-missing")).toHaveTextContent(/not available/);
  });
});
