import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import App, { preloadAllViews } from "./App";
import { loadDashboardParts } from "./utils/loadDashboard";
import { resetVerifiedCache } from "./utils/publication/cache";
import { resetParsedTables } from "./utils/publication/load";
import { BASE_PATH, fixtureFetch, fixtureText } from "./test/publicationFixture";

// The build's verified publication (app/publicationBoot.ts) crosses to the
// page as plain data: built here from the fixture through the same loader
beforeAll(preloadAllViews, 60_000);

const ALPHA_BUDGET = "artifacts/alpha/f3b823a98663f150/budgetary_impact.csv";

async function buildBoot() {
  const serve = fixtureFetch();
  const parts = await loadDashboardParts("", { fetchImpl: (url, init) => serve(`${BASE_PATH}${url}`, init) });
  resetVerifiedCache();
  resetParsedTables();
  return structuredClone(parts);
}

function servePage(options) {
  const serve = fixtureFetch(options);
  vi.stubGlobal("fetch", (url, init) => serve(`${BASE_PATH}${url}`, init));
  return serve;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetVerifiedCache();
  resetParsedTables();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

async function hydrate(boot, address) {
  window.history.replaceState({}, "", "/");
  const html = renderToString(<App boot={boot} />);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const app = container.querySelector(".app");
  window.history.replaceState({}, "", address);
  const errors = [];
  let root;
  await act(async () => {
    root = hydrateRoot(container, <App boot={boot} />, { onRecoverableError: (error) => errors.push(error) });
  });
  return { container, app, errors, root };
}

describe("the build's verified publication", () => {
  it("is in the server's HTML: the figures' catalogue, marked as checked by the build", async () => {
    const boot = await buildBoot();
    const html = renderToString(<App boot={boot} />);
    expect(html).toContain('data-publication="verified"');
    expect(html).toContain('data-publication-check="build"');
    // Without it the server's HTML waits for the page
    const without = renderToString(<App />);
    expect(without).toContain('data-publication="unavailable"');
  });

  it("hydrates without a mismatch, applies a link's selection, and is confirmed by the page's own check", async () => {
    const boot = await buildBoot();
    const serve = servePage();
    const { container, errors, root } = await hydrate(boot, "/?tab=dashboard&sub=finances&policies=alpha");
    expect(errors).toEqual([]);
    await waitFor(() => expect(container.querySelector('.app[data-publication-check="page"]')).not.toBeNull());
    expect(container.querySelector('.app[data-publication="verified"]')).not.toBeNull();
    expect(new URLSearchParams(window.location.search).get("policies")).toBe("alpha");
    // The page checked the bytes itself: it requested the manifest and the receipts
    expect(serve.calls.some((url) => url.endsWith("/data/manifest.json"))).toBe(true);
    expect(serve.calls.some((url) => url.endsWith("/receipt.json"))).toBe(true);
    act(() => root.unmount());
  });

  it("gives way to the page's own figures when a file no longer matches what the build verified", async () => {
    const boot = await buildBoot();
    const tampered = fixtureText(ALPHA_BUDGET).replace(/\d(?=[^\d]*$)/, (digit) => String((Number(digit) + 1) % 10));
    servePage({ overrides: { [ALPHA_BUDGET]: tampered } });
    const { container, root } = await hydrate(boot, "/?tab=policies");
    await waitFor(() => expect(container.querySelector('.app[data-publication-check="page"]')).not.toBeNull());
    // Alpha's artifact fails the page's check: the build's copy of its
    // figures is gone, and it is no longer a policy shown
    expect(renderToString(<App boot={boot} />)).toContain("All 7 policies");
    expect(container.textContent).toContain("All 6 policies");
    expect(container.querySelector(".policy-details-content").textContent).not.toContain("Alpha");
    act(() => root.unmount());
  });

  it("is withdrawn when the page cannot verify the publication", async () => {
    const boot = await buildBoot();
    servePage({ overrides: { "manifest.json": 500 } });
    const { container, root } = await hydrate(boot, "/?tab=policies");
    await waitFor(() => expect(container.querySelector('.app[data-publication="unavailable"]')).not.toBeNull());
    expect(container.querySelector(".app").getAttribute("data-publication-check")).toBe("page");
    act(() => root.unmount());
  });
});
