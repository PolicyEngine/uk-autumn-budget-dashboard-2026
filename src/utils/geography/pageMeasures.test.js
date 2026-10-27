/**
 * The page's measures in the constituency views.
 *
 * `uk-budget-data constituencies` publishes each measure by constituency
 * under its manifest key, and the package under its alias (PACKAGES in
 * src/uk_budget_data/geography.py). Its area_provenance.json records the
 * manifest key each stands for, and `publish index` gives the page the
 * package's: the combined run of exactly the displayable measures, the one
 * the catalogue names the package (`combinedId`). Here the layer's
 * synthetic table stands in for the run's, its rows copied out under each
 * fixture measure and the package's alias, and bound to the fixture
 * manifest as `publish index` binds it: invented figures and made-up seats
 * (Z14...), never real data.
 */

import { createElement } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConstituencyView } from "../../hooks/useConstituencyView";
import { BOUNDARIES_FILE, resetGeographyCache } from "../../hooks/useGeographyData";
import { areaRouting, geographyFixture } from "../../test/geographyFixture";
import {
  BETA,
  COMBINED,
  bindFlatFiles,
  measureCatalogueFixture,
} from "../../test/measureCatalogueFixture";
import {
  buildMeasureCatalogue,
  MeasureCatalogueProvider,
} from "../measureCatalogue";
import { SELECTION_NOT_PUBLISHED, choiceLabel } from "./selection";

// TEST DATA ONLY: the area run's name for the package
const ALIAS = "synthetic_package_alias";
const MEASURES = buildMeasureCatalogue(
  measureCatalogueFixture({ held: false }),
).displayable.map((measure) => [measure.id, measure.name]);
const IDS = MEASURES.map(([id]) => id);

/** The synthetic table, with a copy of its rows for each of `reforms`. */
function layerTable(reforms) {
  const text = geographyFixture("layer/constituency.csv");
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
  return [header, ...copies].join("\n") + "\n";
}

/**
 * The page's catalogue, with `table` (null: none published) bound to its
 * manifest and the package's alias to its combined run, and the release's
 * routing, as the page fetches them.
 */
async function publish(table, routing = areaRouting("available")) {
  const fixture = measureCatalogueFixture({ held: false });
  const bound =
    table === null
      ? {}
      : await bindFlatFiles(
          fixture.manifest,
          { "constituency.csv": table },
          { [ALIAS]: COMBINED },
        );
  const files = {
    ...bound,
    "area-routing.json": routing,
    // The boundaries under the page's own file name (TopoJSON on the page;
    // the loader reads a feature collection too)
    [BOUNDARIES_FILE]: geographyFixture("constituencies.geojson"),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const name = String(url).slice(String(url).indexOf("/data/") + 6);
      return Object.hasOwn(files, name)
        ? new Response(files[name])
        : new Response(null, { status: 404 });
    }),
  );
  return buildMeasureCatalogue(fixture);
}

/** What the constituency views show for `selected`, once it has loaded. */
async function show(catalogue, selected) {
  const wrapper = ({ children }) =>
    createElement(MeasureCatalogueProvider, { catalogue }, children);
  const { result } = renderHook(
    () =>
      useConstituencyView({
        selectedPolicies: selected,
        policies: catalogue.displayable,
        selectedYear: 2026,
        outcome: "relative_change",
      }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.view.kind).not.toBe("loading"));
  return result.current;
}

beforeEach(() => resetGeographyCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the page's measures in the constituency views", () => {
  it.each(MEASURES)("shows %s on its own, by its id", async (id, name) => {
    const catalogue = await publish(layerTable([...IDS, ALIAS]));
    const { choice, view } = await show(catalogue, [id]);
    expect(choiceLabel(choice, catalogue.displayable)).toBe(name);
    expect(view.kind).toBe("rows");
    expect(view.reform).toBe(id);
    expect(view.rows.length).toBeGreaterThan(0);
  });

  it("shows the package, under its alias, when every measure is selected", async () => {
    const catalogue = await publish(layerTable([...IDS, ALIAS]));
    expect(catalogue.combinedId).toBe(COMBINED);
    const { choice, view } = await show(catalogue, IDS);
    expect(choiceLabel(choice, catalogue.displayable)).toBe(
      "All policies (the full package)",
    );
    expect(view).toMatchObject({ kind: "rows", reform: COMBINED });
  });

  it("says so for a measure the run left out, and for the package", async () => {
    // A measure a limit holds, and so the package that includes it
    const catalogue = await publish(
      layerTable(IDS.filter((id) => id !== BETA)),
    );
    expect((await show(catalogue, [BETA])).view.reason).toBe(
      "Results by constituency are not yet published for this policy.",
    );
    // With no package published, every measure selected says the
    // combination is not published: never one measure in its place, nor a
    // sum, and no per-policy option on the card.
    const all = await show(catalogue, IDS);
    expect(all.choice.kind).toBe("no-package");
    expect(all.choice.reform).toBeUndefined();
    expect(all.choice).not.toHaveProperty("focus");
    expect(all.view).toEqual({ kind: "notice", reason: SELECTION_NOT_PUBLISHED, detail: null });
  });

  it("reads not yet published while no table is published", async () => {
    const catalogue = await publish(null);
    for (const selected of [[IDS[0]], IDS]) {
      expect((await show(catalogue, selected)).view).toMatchObject({
        kind: "notice",
        reason: "Results by constituency are not yet published.",
      });
    }
  });

  it("reads not available on a release that routes no results by area", async () => {
    const catalogue = await publish(
      layerTable([...IDS, ALIAS]),
      areaRouting("not_available"),
    );
    expect((await show(catalogue, [IDS[0]])).view).toMatchObject({
      kind: "notice",
      reason: "Results by constituency are not available on this release.",
    });
  });
});
