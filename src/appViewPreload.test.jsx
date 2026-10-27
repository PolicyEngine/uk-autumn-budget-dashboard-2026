import { afterEach, describe, expect, it, vi } from "vitest";

// The view code App's module starts loading as it is first evaluated, from
// the address the page opened at, before any render (App.jsx): the chart
// views' chunk is counted each time it is imported
const loaded = vi.hoisted(() => ({ chartViews: 0 }));
vi.mock("./components/chartViews", async (importOriginal) => {
  loaded.chartViews += 1;
  return importOriginal();
});

async function evaluateAppAt(address) {
  window.history.replaceState({}, "", address);
  vi.resetModules();
  loaded.chartViews = 0;
  await import("./App");
}

describe("the view code App starts from the address", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("starts a past event's view, in the chart views' chunk, on a link to one", async () => {
    await evaluateAppAt("/?budget=uk-autumn-budget-2025");
    await vi.waitFor(() => expect(loaded.chartViews).toBe(1));
  }, 60_000);

  it("starts a linked view of this Budget's, as before", async () => {
    await evaluateAppAt("/?tab=dashboard");
    await vi.waitFor(() => expect(loaded.chartViews).toBe(1));
  }, 60_000);

  it("starts none on this Budget's landing page", async () => {
    await evaluateAppAt("/");
    // Nothing to wait for: give a started import time to show
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(loaded.chartViews).toBe(0);
  }, 60_000);
});
