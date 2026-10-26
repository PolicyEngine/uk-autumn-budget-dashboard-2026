/**
 * The page's measures in the constituency views.
 *
 * `uk-budget-data constituencies` publishes each measure by constituency
 * under its own id from src/uk_budget_data/reforms.py, and the package under
 * the one id that ends in `_combined` (tests/test_reforms.py keeps the ids
 * in src/utils/policies.js those of reforms.py). Here the layer's synthetic
 * table stands in for that file, its package's rows copied out under the
 * page's ids: invented figures and made-up seats (Z14...), never real data.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLICIES } from "../policies";
import { parseGeographyTable } from "./parse";
import { chooseReform, choiceLabel, PACKAGE_SUFFIX } from "./selection";
import { viewState } from "./view";

const LAYER_TABLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "geography",
  "layer",
  "constituency.csv",
);
const PACKAGE = `autumn_budget_2026${PACKAGE_SUFFIX}`;
const policyIds = POLICIES.map((policy) => policy.id);
const AVAILABLE = {
  status: "ready",
  routing: { areaViews: "available", regionalReleaseKind: "local_area" },
};
const NOT_ROUTED = {
  status: "ready",
  routing: { areaViews: "not_available", regionalReleaseKind: null },
};

/** The synthetic table, with a copy of its rows for each of `reforms`. */
function tableFor(reforms) {
  const text = readFileSync(LAYER_TABLE, "utf-8");
  // Its names carry no comma, so a line splits on commas.
  expect(text).not.toContain('"');
  const [header, ...lines] = text.trimEnd().split("\n");
  const column = header.split(",").indexOf("reform");
  const copies = reforms.flatMap((reform) =>
    lines.map((line) => {
      const cells = line.split(",");
      cells[column] = reform;
      return cells.join(",");
    }),
  );
  return parseGeographyTable([header, ...copies].join("\n") + "\n", {
    level: "constituency",
  });
}

function view(table, selectedIds, routing = AVAILABLE) {
  const choice = chooseReform({
    selectedIds,
    policyIds,
    reforms: table?.reforms ?? [],
  });
  const data = table
    ? { status: "ready", table }
    : { status: "unavailable", table: null };
  return {
    choice,
    state: viewState({
      data,
      choice,
      year: 2026,
      outcome: "relative_change",
      place: "by constituency",
      routing,
    }),
  };
}

describe("the page's measures in the constituency views", () => {
  const published = tableFor([...policyIds, PACKAGE]);

  it.each(POLICIES.map((policy) => [policy.id, policy.name]))(
    "shows %s on its own, by its id",
    (id, name) => {
      const { choice, state } = view(published, [id]);
      expect(choiceLabel(choice, POLICIES)).toBe(name);
      expect(state.kind).toBe("rows");
      expect(state.reform).toBe(id);
      expect(state.rows.length).toBeGreaterThan(0);
    },
  );

  it("shows the package when every measure is selected", () => {
    const { choice, state } = view(published, policyIds);
    expect(choiceLabel(choice, POLICIES)).toBe("All measures (the full package)");
    expect(state).toMatchObject({ kind: "rows", reform: PACKAGE });
  });

  it("says so for a measure the run left out, and for the package", () => {
    // A measure a model limit holds, and the package that includes it
    const held = "road_fuel_vat_cut";
    const table = tableFor(policyIds.filter((id) => id !== held));
    expect(view(table, [held]).state.reason).toBe(
      "Results by constituency are not yet published for this measure.",
    );
    expect(view(table, policyIds).state.reason).toBe(
      "Results by constituency are not yet published for the full package.",
    );
  });

  it("reads not yet published while the file is absent", () => {
    for (const selected of [[policyIds[0]], policyIds]) {
      expect(view(null, selected).state).toMatchObject({
        kind: "notice",
        reason: "Results by constituency are not yet published.",
      });
    }
  });

  it("reads not available on a release that routes no results by area", () => {
    expect(view(published, [policyIds[0]], NOT_ROUTED).state).toMatchObject({
      kind: "notice",
      reason: "Results by constituency are not available on this release.",
    });
  });
});
