import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePublication } from "./usePublication";
import {
  BASE_PATH,
  fixtureFetch,
  fixtureJson,
} from "../test/publicationFixture";

const manifest = fixtureJson("manifest.json");
const receiptOf = (id) => `${manifest.measures[id].artifact}/receipt.json`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePublication", () => {
  it("is ready with the verified tables for the selection", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    const { result } = renderHook(() =>
      usePublication(BASE_PATH, ["alpha", "beta"]),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(Object.keys(result.current.tablesByKey).sort()).toEqual([
      "alpha",
      "beta",
      "combined--alpha+beta",
    ]);
  });

  it("reports no manifest", async () => {
    vi.stubGlobal(
      "fetch",
      fixtureFetch({ overrides: { "manifest.json": 404 } }),
    );
    const { result } = renderHook(() => usePublication(BASE_PATH, ["alpha"]));
    await waitFor(() => expect(result.current.status).toBe("no-manifest"));
  });

  it("reports an error and shows nothing when the manifest is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      fixtureFetch({ overrides: { "manifest.json": '{"schema":"x"}' } }),
    );
    const { result } = renderHook(() => usePublication(BASE_PATH, ["alpha"]));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.tablesByKey).toEqual({});
  });

  it("drops a slow response for a selection that is no longer current", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const alpha = receiptOf("alpha");
    const fetchImpl = fixtureFetch({
      delays: { [alpha]: gate },
      ignoreAbort: true,
    });
    vi.stubGlobal("fetch", fetchImpl);
    const { result, rerender } = renderHook(
      ({ ids }) => usePublication(BASE_PATH, ids),
      { initialProps: { ids: ["alpha"] } },
    );
    rerender({ ids: ["beta"] });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.selection).toEqual(["beta"]);
    release();
    // Let the stale request settle; it must not replace the current one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.selection).toEqual(["beta"]);
    expect(Object.keys(result.current.tablesByKey)).toEqual(["beta"]);
  });

  it("keeps the last complete selection while a new one loads", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const beta = receiptOf("beta");
    vi.stubGlobal("fetch", fixtureFetch({ delays: { [beta]: gate } }));
    const { result, rerender } = renderHook(
      ({ ids }) => usePublication(BASE_PATH, ids),
      { initialProps: { ids: ["alpha"] } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ ids: ["beta"] });
    expect(result.current.status).toBe("loading");
    expect(result.current.selection).toEqual(["alpha"]);
    release();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.selection).toEqual(["beta"]);
  });
});
