import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useDataFile from "./useDataFile";

afterEach(() => vi.unstubAllGlobals());

const parse = (text) => text.split("\n");

describe("useDataFile", () => {
  it("fetches nothing for a null name (a file only a hidden figure reads)", () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const { result } = renderHook(() => useDataFile(null, parse));
    expect(result.current).toEqual({ status: "off", rows: null });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("fetches and parses a named file", async () => {
    const fetchStub = vi.fn(async () => ({ ok: true, text: async () => "a\nb" }));
    vi.stubGlobal("fetch", fetchStub);
    const { result } = renderHook(() => useDataFile("use-data-file-test.csv", parse));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toEqual(["a", "b"]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
