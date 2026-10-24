import { readFileSync } from "node:fs";
import fc from "fast-check";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureJson } from "./test/publicationFixture";

const outlook = readFileSync("public/data/living_standards_outlook.json", "utf8");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["missing", "invalid", "unreachable", "2025"])("keeps the shell and independent views available for a %s manifest", async (failure) => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("living", "methodology"),
    async (view) => {
      const requests = [];
      vi.stubGlobal("fetch", async (url) => {
        requests.push(String(url));
        if (String(url).endsWith("living_standards_outlook.json")) return new Response(outlook);
        if (String(url).endsWith("manifest.json")) {
          if (failure === "unreachable") throw new TypeError("offline");
          if (failure === "missing") return new Response(null, { status: 404 });
          const manifest = failure === "invalid" ? {} : {
            ...fixtureJson("manifest.json"), release: "autumn-budget-2025",
            budget: { id: "autumn-budget-2025", date: "2025-11-26" },
          };
          return Response.json(manifest);
        }
        return new Response(null, { status: 404 });
      });
      window.history.replaceState({}, "", `/?tab=${view}`);
      render(<App />);
      expect(await screen.findByRole("tablist", { name: "Views" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "UK Autumn Budget 2026" })).toBeInTheDocument();
      const label = view === "living" ? "Living standards" : "Methodology";
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByRole("heading", { name: view === "living" ? "Incomes" : "At a glance" })).toBeInTheDocument();
      expect(requests.some((url) => url.endsWith(".csv"))).toBe(false);
      cleanup();
      vi.unstubAllGlobals();
    },
  ), { numRuns: 4 });
});


it("renders an independent view while the manifest request is still pending", async () => {
  vi.stubGlobal("fetch", async (url) => {
    if (String(url).endsWith("manifest.json")) return new Promise(() => {});
    if (String(url).endsWith("living_standards_outlook.json")) return new Response(outlook);
    return new Response(null, { status: 404 });
  });
  window.history.replaceState({}, "", "/?tab=methodology");
  render(<App />);
  expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "At a glance" })).toBeInTheDocument();
});

it("keeps a requested selection in the address while publication is loading", () => {
  vi.stubGlobal("fetch", async () => new Promise(() => {}));
  window.history.replaceState({}, "", "/?policies=alpha");
  render(<App />);
  expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("policies")).toBe("alpha");
});
