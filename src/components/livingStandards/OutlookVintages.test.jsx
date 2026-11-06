/**
 * The Pre-measures forecast view's Forecast vintages sub-tab
 * (?tab=outlook&sub=vintages). It reads its own file, so it shows even when
 * the outlook cannot be read; its measure is in ?variable=, beside the
 * view's ?sub=; and its link opens the Forecast changes sub-tab in place,
 * with focus on that tab.
 * A file of its own, so the outlook loader starts with nothing cached.
 */
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../App";
import { resetForecastVintages } from "../../utils/forecastVintages/load";

const VINTAGES = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
// The address's parameters, whatever their order
const address = () => Object.fromEntries(new URLSearchParams(window.location.search));

afterEach(() => {
  vi.unstubAllGlobals();
});

// The vintages file as committed, unless `vintages` says otherwise; the
// outlook and the manifest missing
function stubFetch({ vintages = () => new Response(VINTAGES, { status: 200 }) } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith("obr_forecast_vintages.json")) return vintages();
      if (path.endsWith("living_standards_outlook.json")) return new Response("", { status: 404 });
      if (path.endsWith("manifest.json")) return new Response(null, { status: 404 });
      return new Response("reform_id,year,value\n", { status: 200 });
    }),
  );
}

it("shows the forecast vintages when the outlook cannot be read, and links to Forecast changes in place", async () => {
  stubFetch();
  window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
  render(<App />);
  expect(
    await screen.findByRole("heading", { level: 3, name: "Real household disposable income per head" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Forecast vintages" })).toHaveAttribute("aria-selected", "true");

  fireEvent.click(screen.getByRole("button", { name: /^Measure: / }));
  fireEvent.click(screen.getByRole("option", { name: "Public sector net borrowing" }));
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });

  const link = screen.getByRole("link", { name: "Forecast changes" });
  link.focus();
  fireEvent.click(link);
  expect(screen.getByRole("tab", { name: "Forecast changes" })).toHaveAttribute("aria-selected", "true");
  // The link's panel is hidden now, so focus moves to the tab it opened
  expect(screen.getByRole("tab", { name: "Forecast changes" })).toHaveFocus();
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/Could not load outlook data/);
  expect(address()).toEqual({ tab: "outlook", sub: "forecast" });

  // Back on Forecast vintages, the measure left open stays
  fireEvent.click(screen.getByRole("tab", { name: "Forecast vintages" }));
  expect(screen.getByRole("heading", { level: 3, name: "Public sector net borrowing" })).toBeInTheDocument();
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });

  // Another view takes both out of the address
  fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
  expect(address()).toEqual({ tab: "methodology" });
});

it("keeps a ?variable= a link brought until Forecast vintages is first opened, which opens that measure", async () => {
  stubFetch();
  // Forecast vintages is not mounted until it is opened, so nothing reads
  // or clears ?variable= on Living standards, the default
  window.history.replaceState({}, "", "/?tab=outlook&variable=psnb");
  render(<App />);
  const view = await screen.findByRole("tabpanel", { name: "Pre-measures forecast" });
  expect(await within(view).findByRole("tab", { name: "Living standards" })).toHaveAttribute("aria-selected", "true");
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/Could not load outlook data/);
  expect(address()).toEqual({ tab: "outlook", variable: "psnb" });

  fireEvent.click(screen.getByRole("tab", { name: "Forecast vintages" }));
  expect(
    await screen.findByRole("heading", { level: 3, name: "Public sector net borrowing" }),
  ).toBeInTheDocument();
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });
});

// Found by review round 19: the measure a link asked for stayed in the
// address, on the outlook's other sub-tabs and on other views, when the
// vintages file could not be read
it("takes a link's ?variable= out of the address on leaving Forecast vintages whose file cannot be read", async () => {
  resetForecastVintages();
  stubFetch({ vintages: () => new Response("", { status: 404 }) });
  window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=psnb");
  render(<App />);
  expect(await screen.findByText("OBR forecasts are unavailable")).toBeInTheDocument();
  expect(address()).toEqual({ tab: "outlook", sub: "vintages", variable: "psnb" });

  fireEvent.click(screen.getByRole("tab", { name: "Forecast changes" }));
  expect(address()).toEqual({ tab: "outlook", sub: "forecast" });

  fireEvent.click(screen.getByRole("tab", { name: "Policies" }));
  expect(address()).toEqual({ tab: "policies" });
});
