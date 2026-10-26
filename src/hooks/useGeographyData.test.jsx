import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook as renderHookReact, waitFor } from "@testing-library/react";
import { AREA_ROUTING_CONTENTS } from "../../scripts/check-public-files.mjs";
import {
  loadAreaRouting,
  loadBoundaries,
  loadGeographyFile,
  resetGeographyCache,
  useAreaRouting,
  useConstituencyBoundaries,
  useGeographyData,
} from "./useGeographyData";
import {
  AREA_ROUTING_URL,
  areaRouting,
  geographyFetch,
  geographyFixture,
} from "../test/geographyFixture";

import { geographyCatalogue, GeographyCatalogueProvider } from "../test/geographyCatalogueFixture";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

vi.mock("../utils/publication/flat", async (importOriginal) => {
  const { unverifiedFlatLoader } = await import("../test/flatLoaderMock");
  return { ...(await importOriginal()), ...unverifiedFlatLoader() };
});

const renderHook = (callback, options = {}) => renderHookReact(callback, { wrapper: GeographyCatalogueProvider, ...options });

// Written by uk_budget_data.area_routing from the installed bundle.
const PUBLIC_AREA_ROUTING = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "public",
    "data",
    "area-routing.json",
  ),
  "utf-8",
);

beforeEach(() => resetGeographyCache());
afterEach(() => vi.unstubAllGlobals());

describe("useGeographyData", () => {
  it("is loading, then ready with the checked table", async () => {
    vi.stubGlobal("fetch", geographyFetch());
    const { result } = renderHook(() => useGeographyData("regional"));
    expect(result.current.status).toBe("loading");
    expect(result.current.table).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.table.level).toBe("region");
    expect(result.current.table.reforms).toContain("fuel_duty_freeze");
  });

  it("fetches each file once, however many components ask", async () => {
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() => useGeographyData("regional"));
    const second = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    // A component mounted later reads the cache at once.
    const third = renderHook(() => useGeographyData("regional"));
    expect(third.result.current.status).toBe("ready");
    expect(third.result.current.table).toEqual(first.result.current.table);
    expect(fetchImpl.calls).toEqual(["/data/regional.csv"]);
  });

  it("withholds every row when the published file cannot be loaded", async () => {
    vi.stubGlobal("fetch", geographyFetch({ "/data/regional.csv": 404 }));
    const { result } = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.table).toBeNull();
  });

  it("does not request a file the build does not ship", async () => {
    const fetchImpl = geographyFetch();
    const state = await loadGeographyFile("regional", {
      fetchImpl,
      base: "",
      published: ["constituency.csv"],
    });
    expect(state.status).toBe("unavailable");
    expect(fetchImpl.calls).toEqual([]);
    const shipped = await loadGeographyFile("regional", {
      fetchImpl,
      base: "",
      published: ["regional.csv"],
    });
    expect(shipped.status).toBe("ready");
    expect(fetchImpl.calls).toEqual(["/data/regional.csv"]);
  });

  it("refuses the 2025 constituency table and keeps no rows", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/constituency.csv": geographyFixture("legacy-constituency-2025.csv"),
      }),
    );
    const { result } = renderHook(() => useGeographyData("constituency"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.table).toBeNull();
    expect(result.current.error).toMatch(/columns are not the published ones/);
  });

  it("refuses an HTTP error, a network failure and invalid UTF-8", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/regional.csv": 500 }),
    );
    let hook = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));

    resetGeographyCache();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    hook = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));

    resetGeographyCache();
    vi.stubGlobal(
      "fetch",
      async () => new Response(new Uint8Array([0xff, 0xfe, 0x00]), { status: 200 }),
    );
    hook = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
  });

  it("never shows a slow answer for a file it no longer asks for", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/regional.csv": gate.then(() => geographyFixture("regional.csv")),
      }),
    );
    const { result, rerender } = renderHook(
      ({ name }) => useGeographyData(name),
      { initialProps: { name: "regional" } },
    );
    rerender({ name: "constituency" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.table.level).toBe("constituency");
    await act(async () => {
      release();
      await gate;
    });
    expect(result.current.table.level).toBe("constituency");
  });
});

describe("useConstituencyBoundaries", () => {
  it("loads the boundary features once", async () => {
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { result } = renderHook(() => useConstituencyBoundaries());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.features).toHaveLength(8);
    expect(fetchImpl.calls).toEqual(["/data/uk_constituencies_2024.topo.json"]);
  });

  it("reports boundaries that are not a feature collection", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/uk_constituencies_2024.topo.json": "{}" }),
    );
    const { result } = renderHook(() => useConstituencyBoundaries());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

describe("useAreaRouting", () => {
  it("reads the release's routing once, however many components ask", async () => {
    const fetchImpl = geographyFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() => useAreaRouting());
    expect(first.result.current.status).toBe("loading");
    expect(first.result.current.routing).toBeNull();
    const second = renderHook(() => useAreaRouting());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    expect(first.result.current.routing).toEqual({
      areaViews: "available",
      regionalReleaseKind: "local_area",
    });
    expect(second.result.current).toBe(first.result.current);
    expect(fetchImpl.calls).toEqual([AREA_ROUTING_URL]);
  });

  // The module writes a kind with not_available for a routing that is
  // missing a template.
  it.each([null, "local_area", "area_coded_national"])(
    "reads a release that routes no results by area, with the kind %s",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        geographyFetch({
          [AREA_ROUTING_URL]: areaRouting("not_available", kind),
        }),
      );
      const { result } = renderHook(() => useAreaRouting());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.routing).toEqual({
        areaViews: "not_available",
        regionalReleaseKind: kind,
      });
    },
  );

  it("reads the file the Python side wrote for the installed bundle", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ [AREA_ROUTING_URL]: PUBLIC_AREA_ROUTING }),
    );
    const { result } = renderHook(() => useAreaRouting());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(["available", "not_available"]).toContain(
      result.current.routing.areaViews,
    );
  });

  it("says a missing file is unavailable", async () => {
    vi.stubGlobal("fetch", geographyFetch({ [AREA_ROUTING_URL]: 404 }));
    const { result } = renderHook(() => useAreaRouting());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.routing).toBeNull();
  });

  it("tries a missing file again on the next view, under the same publication", async () => {
    vi.stubGlobal("fetch", geographyFetch({ [AREA_ROUTING_URL]: 404 }));
    const first = renderHook(() => useAreaRouting());
    await waitFor(() => expect(first.result.current.status).toBe("unavailable"));
    first.unmount();
    vi.stubGlobal("fetch", geographyFetch());
    const second = renderHook(() => useAreaRouting());
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.routing.areaViews).toBe("available");
  });

  it("keeps an answer for its publication and reads routing again for a newer one", async () => {
    const before = geographyFetch({ [AREA_ROUTING_URL]: areaRouting("not_available") });
    vi.stubGlobal("fetch", before);
    const first = renderHook(() => useAreaRouting());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    const after = geographyFetch();
    vi.stubGlobal("fetch", after);
    const same = renderHook(() => useAreaRouting());
    expect(same.result.current.routing.areaViews).toBe("not_available");
    expect(after.calls).toEqual([]);
    same.unmount();
    const newer = buildMeasureCatalogue({
      manifest: { ...geographyCatalogue.manifest, revision: 2, snapshotSha256: "b".repeat(64) },
      tablesByKey: geographyCatalogue.tablesByKey,
    });
    const next = renderHookReact(() => useAreaRouting(), {
      wrapper: ({ children }) => <MeasureCatalogueProvider catalogue={newer}>{children}</MeasureCatalogueProvider>,
    });
    await waitFor(() => expect(next.result.current.status).toBe("ready"));
    expect(next.result.current.routing.areaViews).toBe("available");
    expect(after.calls).toEqual([AREA_ROUTING_URL]);
  });

  it("reads every answer the public file checks accept, as written", async () => {
    expect(AREA_ROUTING_CONTENTS.size).toBe(5);
    for (const text of AREA_ROUTING_CONTENTS) {
      const fetchImpl = geographyFetch({ [AREA_ROUTING_URL]: text });
      const answer = await loadAreaRouting({ fetchImpl, base: "" });
      const written = JSON.parse(text);
      expect(answer.status, text).toBe("ready");
      expect(answer.routing).toEqual({
        areaViews: written.area_views,
        regionalReleaseKind: written.regional_release_kind,
      });
    }
  });

  it.each([
    ["an HTTP error", 500],
    [
      "an HTTP error whose body says available",
      { status: 503, body: areaRouting("available") },
    ],
    ["text that is not JSON", "available\n"],
    ["an empty object", "{}\n"],
    ["a list", "[]\n"],
    ["null", "null\n"],
    [
      "an unknown status",
      '{"area_views": "partly", "regional_release_kind": null}',
    ],
    [
      "an unknown status with a served kind",
      '{"area_views": "partly", "regional_release_kind": "local_area"}',
    ],
    ["a missing kind", '{"area_views": "not_available"}'],
    // The module writes available only with a kind the area run serves.
    ["available with no kind", areaRouting("available", null)],
    ["available with an unknown kind", areaRouting("available", "state_release")],
    [
      "not available with an unknown kind",
      areaRouting("not_available", "state_release"),
    ],
    [
      "another field",
      '{"area_views": "available", "regional_release_kind": "local_area", "x": 1}',
    ],
  ])("refuses %s, and says nothing about the release", async (_, answer) => {
    vi.stubGlobal("fetch", geographyFetch({ [AREA_ROUTING_URL]: answer }));
    const { result } = renderHook(() => useAreaRouting());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.routing).toBeNull();
  });

  it("refuses a network failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    const { result } = renderHook(() => useAreaRouting());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

describe("the TopoJSON boundaries", () => {
  it("decodes the published file to the GeoJSON's seats, with the properties the page reads", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (name) => readFileSync(join(process.cwd(), "public", "data", name), "utf-8");
    const topo = read("uk_constituencies_2024.topo.json");
    const geojson = JSON.parse(read("uk_constituencies_2024.geojson"));
    const fetchImpl = async () => new Response(topo, { status: 200 });
    const state = await loadBoundaries({ fetchImpl, base: "" });
    expect(state.status).toBe("ready");
    expect(state.features.map((f) => f.properties.GSScode)).toEqual(geojson.features.map((f) => f.properties.GSScode));
    for (const [index, feature] of state.features.entries()) {
      const source = geojson.features[index].properties;
      expect(feature.properties).toEqual({ Name: source.Name, CTR_REG: source.CTR_REG, Country: source.Country, GSScode: source.GSScode });
    }
  });
});
