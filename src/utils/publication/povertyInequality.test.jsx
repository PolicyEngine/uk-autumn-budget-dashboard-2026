/**
 * The poverty and inequality measures from verified artifacts (#185 on
 * #104): an artifact's poverty_inequality table, verified against its
 * receipt like every other table, is merged into its metrics rows, so the
 * Poverty and Inequality charts offer their pills from receipted data.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import contract from "./contract.json";
import { FLAT_EXTRA_COLUMNS, TableError, parseTable, withPovertyInequality } from "./csv";
import { artifactSha256, jcsSha256, sha256Hex } from "./digest";
import { loadArtifact } from "./load";
import { BASE_PATH, fixtureFetch, fixtureJson, fixtureText } from "../../test/publicationFixture";
import SummaryMetricChart, { SUMMARY_METRICS, choiceRows } from "../../components/SummaryMetricChart";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../measureCatalogue";

const manifest = fixtureJson("manifest.json");
const KEY_COLUMNS = ["reform_id", "reform_name", "year"];
const MEASURES = FLAT_EXTRA_COLUMNS.metrics.map(([column]) => column);

/** Alpha's metrics years, so the extra table covers exactly them. */
function alphaMetrics() {
  return parseTable("metrics", fixtureText(`${manifest.measures.alpha.artifact}/metrics.csv`));
}

/** poverty_inequality.csv for alpha: each measure a distinct value. */
function povertyInequalityCsv(years) {
  const header = [...KEY_COLUMNS, ...MEASURES].join(",");
  const lines = years.map((year, row) => ["alpha", "Alpha", year, ...MEASURES.map((_, index) => -(index + 1 + row / 10))].join(","));
  return `${header}\n${lines.join("\n")}\n`;
}

/**
 * Alpha's artifact as a generation run with the table writes it: its
 * receipt lists the file, and the manifest entry names that receipt.
 * The browser checks only what the manifest names, so this is the same
 * chain a real artifact passes.
 */
async function alphaWithPovertyInequality(text = povertyInequalityCsv(alphaMetrics().map((row) => row.year))) {
  const entry = structuredClone(manifest.measures.alpha);
  const receipt = fixtureJson(`${entry.artifact}/receipt.json`);
  receipt.dashboard.files["poverty_inequality.csv"] = await sha256Hex(new TextEncoder().encode(text));
  const outputs = await jcsSha256(receipt.dashboard.files);
  receipt.dashboard.digests.outputs_sha256 = outputs;
  entry.outputs_sha256 = outputs;
  entry.artifact_sha256 = await artifactSha256(receipt);
  return {
    entry,
    text,
    fetchImpl: (csv = text) =>
      fixtureFetch({
        overrides: {
          [`${entry.artifact}/receipt.json`]: JSON.stringify(receipt),
          [`${entry.artifact}/poverty_inequality.csv`]: csv,
        },
      }),
  };
}

describe("the poverty_inequality table in the contract", () => {
  it("is optional, keyed by run and year, and carries the 19 measures the flat file adds", () => {
    const table = contract.tables.poverty_inequality;
    expect(table.file).toBe("poverty_inequality.csv");
    expect(table.required).toBe(false);
    expect(table.key).toEqual(["reform_id", "year"]);
    expect(table.columns.slice(0, 3).map(([column]) => column)).toEqual(KEY_COLUMNS);
    expect(MEASURES).toHaveLength(19);
    expect(table.columns.slice(3)).toEqual(FLAT_EXTRA_COLUMNS.metrics);
    expect(MEASURES).toContain("child_poverty_rel_ahc_change_pp");
    expect(MEASURES.slice(-3)).toEqual(["top_10_share_change_pp", "top_1_share_change_pp", "p90_p10_change"]);
  });

  it("leaves metrics with its headline columns, so older artifacts still parse", () => {
    expect(contract.tables.metrics.columns.map(([column]) => column)).toEqual([
      "reform_id", "reform_name", "year", "people_affected", "gini_change", "poverty_change_pp", "poverty_change_pct",
    ]);
    expect(alphaMetrics()).toHaveLength(2);
  });
});

describe("withPovertyInequality", () => {
  const metrics = [
    { reform_id: "a", reform_name: "A", year: 2027, gini_change: 0.1 },
    { reform_id: "a", reform_name: "A", year: 2028, gini_change: 0.2 },
  ];

  it("adds each year's measures to its metrics row", () => {
    const merged = withPovertyInequality(metrics, [{ reform_id: "a", reform_name: "A", year: 2028, p90_p10_change: -0.5 }]);
    expect(merged[0]).toEqual(metrics[0]);
    expect(merged[1]).toEqual({ ...metrics[1], p90_p10_change: -0.5 });
  });

  it("returns the rows as they are without the table", () => {
    expect(withPovertyInequality(metrics, undefined)).toBe(metrics);
    expect(withPovertyInequality(metrics, [])).toBe(metrics);
  });

  it("refuses a row metrics does not have, or one naming the run differently", () => {
    expect(() => withPovertyInequality(metrics, [{ reform_id: "a", reform_name: "A", year: 2030 }])).toThrow(TableError);
    expect(() => withPovertyInequality(metrics, [{ reform_id: "a", reform_name: "B", year: 2027 }])).toThrow(TableError);
  });
});

describe("loadArtifact with poverty_inequality.csv", () => {
  it("merges the verified measures into the metrics rows", async () => {
    const { entry, fetchImpl } = await alphaWithPovertyInequality();
    const loaded = await loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl: fetchImpl() });
    expect(loaded.metrics).toHaveLength(2);
    const [first, second] = loaded.metrics;
    expect(first.poverty_change_pp).toBe(alphaMetrics()[0].poverty_change_pp);
    expect(first.poverty_abs_bhc_change_pp).toBe(-1);
    expect(first.p90_p10_change).toBe(-19);
    expect(second.child_poverty_rel_ahc_change_pp).toBeCloseTo(-15.1);
    for (const column of MEASURES) expect(typeof first[column]).toBe("number");
  });

  it("refuses a file that is not the one the receipt lists", async () => {
    const { entry, text, fetchImpl } = await alphaWithPovertyInequality();
    const tampered = text.replace("-19", "-18");
    await expect(loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl: fetchImpl(tampered) })).rejects.toThrow(
      "poverty_inequality.csv does not match its receipt",
    );
  });

  it("refuses a receipted file without every measure", async () => {
    const text = "reform_id,reform_name,year,p90_p10_change\nalpha,Alpha,2032,-1\n";
    const { entry, fetchImpl } = await alphaWithPovertyInequality(text);
    await expect(loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl: fetchImpl() })).rejects.toThrow(TableError);
  });

  it("loads an artifact written before the table with the headline columns only", async () => {
    const loaded = await loadArtifact(BASE_PATH, "alpha", manifest.measures.alpha, { fetchImpl: fixtureFetch() });
    expect(loaded.poverty_inequality).toBeUndefined();
    expect(Object.keys(loaded.metrics[0])).toEqual(contract.tables.metrics.columns.map(([column]) => column));
  });
});

describe("the Poverty and Inequality pills from verified artifacts", () => {
  const policies = [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const withCatalogue = (ui) =>
    render(<MeasureCatalogueProvider catalogue={buildMeasureCatalogue()}>{ui}</MeasureCatalogueProvider>);

  async function verifiedRows() {
    const { entry, fetchImpl } = await alphaWithPovertyInequality();
    const alpha = await loadArtifact(BASE_PATH, "alpha", entry, { fetchImpl: fetchImpl() });
    const beta = await loadArtifact(BASE_PATH, "beta", manifest.measures.beta, { fetchImpl: fixtureFetch() });
    return [...alpha.metrics, ...beta.metrics];
  }

  it("offers the poverty and inequality choices for a run whose artifact has the measures", async () => {
    const rows = await verifiedRows();
    withCatalogue(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={rows} policies={policies} selectedPolicies={["alpha"]} selectedYear={2027} />);
    expect(screen.getByRole("group", { name: "Poverty line" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Relative" })).toBeInTheDocument();
  });

  it("offers the inequality choices too", async () => {
    const rows = await verifiedRows();
    withCatalogue(<SummaryMetricChart metric={SUMMARY_METRICS.inequality} rows={rows} policies={policies} selectedPolicies={["alpha"]} selectedYear={2027} />);
    expect(screen.getByRole("group", { name: "Inequality measure" })).toBeInTheDocument();
  });

  it("shows the headline only for a run whose artifact predates them, even beside one that has them", async () => {
    const rows = await verifiedRows();
    expect(choiceRows(rows, "beta").every((row) => row.reform_id === "beta")).toBe(true);
    withCatalogue(<SummaryMetricChart metric={SUMMARY_METRICS.poverty} rows={rows} policies={policies} selectedPolicies={["beta"]} selectedYear={2027} />);
    expect(screen.queryByRole("group", { name: "Poverty line" })).toBeNull();
  });
});
