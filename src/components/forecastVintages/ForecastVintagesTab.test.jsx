/**
 * The OBR forecasts tab: the forecast vintages view as a tab of its own,
 * linking to the forecast behind the living standards baseline on Living
 * standards. The view itself is tested in ForecastVintagesView.test.jsx.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ForecastVintagesTab from "./ForecastVintagesTab";
import { resetForecastVintages } from "../../utils/forecastVintages/load";

const TEXT = readFileSync("public/data/obr_forecast_vintages.json", "utf8");

beforeEach(() => {
  resetForecastVintages();
  window.history.replaceState({}, "", "/?tab=forecasts");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(TEXT, { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the forecast vintages view and links to Living standards: Forecast changes", async () => {
  const onShowTab = vi.fn();
  render(<ForecastVintagesTab onShowTab={onShowTab} />);
  expect(await screen.findByRole("heading", { name: "OBR forecasts beside the outturn" })).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Living standards: Forecast changes" });
  expect(link).toHaveAttribute("href", "?tab=living&sub=forecast");
  fireEvent.click(link);
  expect(onShowTab).toHaveBeenCalledWith("living", "forecast");
});

it("lets the browser follow the link when it has no tab switcher", async () => {
  render(<ForecastVintagesTab />);
  const link = await screen.findByRole("link", { name: "Living standards: Forecast changes" });
  // No onShow: the view leaves the click to the browser, which follows the
  // link's address (stopped here, after the view has seen it: jsdom does
  // not navigate)
  let prevented = null;
  const follow = (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", follow);
  fireEvent.click(link);
  document.removeEventListener("click", follow);
  expect(prevented).toBe(false);
});
