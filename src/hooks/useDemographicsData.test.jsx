import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDemographicsData, usePovertyByAge } from "./useDemographicsData";
import { resetGeographyCache } from "./useGeographyData";
import { geographyFetch } from "../test/geographyFixture";
import { POVERTY_CSV, demographicsCsv } from "../test/demographicsFixture";

beforeEach(() => resetGeographyCache());
afterEach(() => vi.unstubAllGlobals());

describe("useDemographicsData", () => {
  it("fetches demographics.csv once and checks every level in it", async () => {
    const fetchImpl = geographyFetch({ "/data/demographics.csv": demographicsCsv() });
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() => useDemographicsData());
    const second = renderHook(() => useDemographicsData());
    expect(first.result.current.status).toBe("loading");
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(first.result.current.table.levels).toEqual([
      "age_group",
      "age_band",
      "young_people",
      "employment",
    ]);
    expect(fetchImpl.calls).toEqual(["/data/demographics.csv"]);
  });

  it("is unavailable before the file is published", async () => {
    vi.stubGlobal("fetch", geographyFetch());
    const { result } = renderHook(() => useDemographicsData());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.table).toBeNull();
  });

  it("shows nothing from a file with a group the page doesn't know", async () => {
    const text = demographicsCsv().replace(/,AGE_80_PLUS,/g, ",AGE_80_89,");
    vi.stubGlobal("fetch", geographyFetch({ "/data/demographics.csv": text }));
    const { result } = renderHook(() => useDemographicsData());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.table).toBeNull();
    expect(result.current.error).toMatch(/^demographics\.csv: row \d+: area_code/);
  });
});

describe("usePovertyByAge", () => {
  it("fetches poverty_by_age.csv once and checks it", async () => {
    const fetchImpl = geographyFetch({ "/data/poverty_by_age.csv": POVERTY_CSV });
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() => usePovertyByAge());
    const second = renderHook(() => usePovertyByAge());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(first.result.current.table.reforms).toContain("two_child_limit");
    expect(fetchImpl.calls).toEqual(["/data/poverty_by_age.csv"]);
  });

  it("is unavailable before the file is published, and an error when malformed", async () => {
    vi.stubGlobal("fetch", geographyFetch());
    const missing = renderHook(() => usePovertyByAge());
    await waitFor(() => expect(missing.result.current.status).toBe("unavailable"));

    resetGeographyCache();
    vi.stubGlobal(
      "fetch",
      geographyFetch({ "/data/poverty_by_age.csv": "reform,year\nx,2029" }),
    );
    const malformed = renderHook(() => usePovertyByAge());
    await waitFor(() => expect(malformed.result.current.status).toBe("error"));
    expect(malformed.result.current.error).toMatch(/^poverty_by_age\.csv: /);
  });
});
