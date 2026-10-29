import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AgeSection from "../AgeSection";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { COMBINATION_NOT_PUBLISHED } from "../../utils/ageImpact";
import { parseTable } from "../../utils/publication/csv";

// A smoke test of By age on the real publication staged locally
// (public/data/manifest.json and public/data/artifacts/, never committed):
// skipped where it is not staged, as in CI. Every card renders with no
// console error, draws something or says why not, and a combination is
// never half drawn.
const DATA = join(process.cwd(), "public", "data");
const STAGED = existsSync(join(DATA, "manifest.json")) && existsSync(join(DATA, "artifacts"));
const YEAR = 2027;
const BANDS = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+"];

vi.setConfig({ testTimeout: 60000 });

vi.mock("recharts", async () => {
  const Chart = ({ data, children }) => <div data-testid="chart-rows" data-rows={JSON.stringify(data ?? [])}>{children}</div>;
  const Empty = () => null;
  return {
    ComposedChart: Chart, BarChart: Chart, ScatterChart: Chart, LineChart: Chart,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    Bar: Empty, Scatter: Empty, Cell: Empty, Tooltip: Empty, Legend: Empty,
    Line: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty,
    ReferenceArea: Empty, ReferenceLine: Empty, LabelList: Empty, Customized: Empty,
  };
});
vi.mock("../ChartDownloadMenu", () => ({ default: () => null }));
vi.mock("../../utils/chartLogo", () => ({
  PolicyEngineLogo: () => null,
  CHART_LOGO: { href: "data:image/png;base64,iVBORw0KGgo=", width: 80, height: 17, padding: 8 },
}));

/** Each artifact's newest table, by reform key. */
function artifactTables(table) {
  const root = join(DATA, "artifacts");
  const out = {};
  for (const key of readdirSync(root)) {
    for (const version of readdirSync(join(root, key))) {
      const file = join(root, key, version, `${table}.csv`);
      if (existsSync(file)) out[key] = parseTable(table, readFileSync(file, "utf8"));
    }
  }
  return out;
}

const loaded = STAGED
  ? (() => {
      const manifest = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8"));
      const budgetary = artifactTables("budgetary_impact");
      const age = artifactTables("age_impact");
      const tablesByKey = Object.fromEntries(Object.keys(age).map((key) => [key, { budgetary_impact: budgetary[key] ?? [] }]));
      return { manifest, budgetary: Object.values(budgetary).flat(), tablesByKey, ageRows: Object.values(age).flat() };
    })()
  : null;

vi.mock("../../utils/loadDashboard", async (importOriginal) => {
  const actual = await importOriginal();
  const { isCatalogueRowDisplayable } = await import("../../utils/measureCatalogue");
  return {
    ...actual,
    peekVerifiedTables: () => null,
    loadVerifiedTable: async (catalogue) =>
      (loaded?.ageRows ?? []).filter((row) => isCatalogueRowDisplayable(catalogue, row.reform_id, row.year)),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chartRows = (container) =>
  [...container.querySelectorAll('[data-testid="chart-rows"]')].map((node) => JSON.parse(node.dataset.rows));
const KEYS = ["netChange", "net", ...BANDS, "all"];
// The winners and losers charts draw shares; a thin single age is left out
// on its own, so shares count as drawn but are not checked for half drawing
const SHARES = ["pct_better_off", "pct_unchanged", "pct_worse_off"];
const drawnValue = (point) => [...KEYS, ...SHARES].some((key) => Number.isFinite(point[key]));

const ids = loaded ? Object.keys(loaded.manifest.measures) : [];
// Two fixed pairs: one with the policy that withholds its age bands from
// 2027-28 (no package: not published by age), one without (drawn whole)
const PAIRS = [
  ["state_pension_income_tax_protection", "fuel_duty_rise_deferral"],
  ["domestic_electricity_zero_vat", "warm_home_discount_top_up"],
];
const SELECTIONS = loaded
  ? [["all", ids], ...ids.map((id) => [id, [id]]), ...PAIRS.filter((pair) => pair.every((id) => ids.includes(id))).map((pair) => [pair.join(" + "), pair])]
  : [];

describe.skipIf(!STAGED)("By age on the staged publication", () => {
  it.each(SELECTIONS)("renders every card for %s with no error and no unexplained empty chart", async (_, selected) => {
    const errors = vi.spyOn(console, "error");
    const catalogue = buildMeasureCatalogue(loaded);
    const { container } = render(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <AgeSection policies={catalogue.measures} selectedPolicies={selected} selectedYear={YEAR} />
      </MeasureCatalogueProvider>,
    );
    await screen.findByRole("heading", { name: /Average change by age/ });
    for (const title of [/Average change by age/, /Change by year/, /Effect of each policy/, /Winners and losers/]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/NaN|undefined|£null/);
    const reason = /not published|not yet published|too few survey records|no published results|changes no household|No effect|unavailable/i;
    for (const rows of chartRows(container)) {
      if (!rows.some(drawnValue)) expect(container.textContent).toMatch(reason);
    }
    if (selected.length > 1) {
      // A combination is drawn whole or said as not published
      expect(container.textContent).not.toMatch(/No line in/);
      for (const rows of chartRows(container)) {
        const points = rows.filter((point) => point.year === undefined || point.year === YEAR);
        for (const key of KEYS) {
          const present = points.filter((point) => key in point);
          if (present.length < 2) continue;
          const drawn = present.filter((point) => Number.isFinite(point[key])).length;
          expect([0, present.length]).toContain(drawn);
        }
      }
    }
    // Every measure together: drawn when the release publishes their
    // combined run (catalogue.combinedId), else said as not published
    // (the 7-measure release of 28 October publishes none)
    if (selected === ids) {
      if (catalogue.combinedId) expect(screen.queryByText(COMBINATION_NOT_PUBLISHED)).toBeNull();
      else expect(screen.getAllByText(COMBINATION_NOT_PUBLISHED).length).toBeGreaterThan(0);
    }
  });
});
