/**
 * The Pre-measures forecast view's Forecast vintages sub-tab
 * (?tab=outlook&sub=vintages). It reads its own file, so it shows even when
 * the outlook cannot be read; its measure is in ?variable=, beside the
 * view's ?sub=; and its link opens the Forecast changes sub-tab in place.
 * A file of its own, so the outlook loader starts with nothing cached.
 */
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "../../App";

const VINTAGES = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
// The address's parameters, whatever their order
const address = () => Object.fromEntries(new URLSearchParams(window.location.search));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows the forecast vintages when the outlook cannot be read, and links to Forecast changes in place", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith("obr_forecast_vintages.json")) return new Response(VINTAGES, { status: 200 });
      if (path.endsWith("living_standards_outlook.json")) return new Response("", { status: 404 });
      if (path.endsWith("manifest.json")) return new Response(null, { status: 404 });
      return new Response("reform_id,year,value\n", { status: 200 });
    }),
  );
  window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
  render(<App />);
  expect(
    await screen.findByRole("heading", { level: 3, name: "Real household disposable income per head" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Forecast vintages" })).toHaveAttribute("aria-selected", "true");

  fireEvent.click(screen.getByRole("button", { name: /^Measure: / }));
  fireEvent.click(screen.getByRole("option", { name: "Public sector net borrowing" }));
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });

  fireEvent.click(screen.getByRole("link", { name: "Forecast changes" }));
  expect(screen.getByRole("tab", { name: "Forecast changes" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load outlook data/);
  expect(address()).toEqual({ tab: "outlook", sub: "forecast" });

  // Back on Forecast vintages, the measure left open stays
  fireEvent.click(screen.getByRole("tab", { name: "Forecast vintages" }));
  expect(screen.getByRole("heading", { level: 3, name: "Public sector net borrowing" })).toBeInTheDocument();
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });

  // Another view takes both out of the address
  fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
  expect(address()).toEqual({ tab: "methodology" });
});
