import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  resetGeographyCache,
  useConstituencyBoundaries,
  useGeographyData,
} from "./useGeographyData";
import {
  geographyFetch,
  geographyFixture,
} from "../test/geographyFixture";

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
    expect(third.result.current.table).toBe(first.result.current.table);
    expect(fetchImpl.calls).toEqual(["/data/regional.csv"]);
  });

  it("says a missing file is unavailable", async () => {
    vi.stubGlobal("fetch", geographyFetch({ "/data/regional.csv": 404 }));
    const { result } = renderHook(() => useGeographyData("regional"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.table).toBeNull();
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
    expect(fetchImpl.calls).toEqual(["/data/uk_constituencies_2024.geojson"]);
  });

  it("reports boundaries that are not a feature collection", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/uk_constituencies_2024.geojson": "{}" }),
    );
    const { result } = renderHook(() => useConstituencyBoundaries());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
