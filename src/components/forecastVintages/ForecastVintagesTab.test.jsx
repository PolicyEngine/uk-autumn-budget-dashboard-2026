/**
 * The OBR forecasts view on the committed file
 * (public/data/obr_forecast_vintages.json), and on files it must refuse:
 * a view whose data cannot be shown says so and shows no figure.
 */
import { readFileSync } from "node:fs";
import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ForecastVintagesTab, { pointsSentence, startsSentence } from "./ForecastVintagesTab";
import { resetForecastVintages } from "../../utils/forecastVintages/load";
import { buildView } from "../../utils/forecastVintages/view";

// jsdom lays nothing out, so ResponsiveContainer would draw nothing: give
// the chart a fixed size
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 900, height: 440 }}>{cloneElement(children, { width: 900, height: 440 })}</div>
    ),
  };
});

const TEXT = readFileSync("public/data/obr_forecast_vintages.json", "utf8");
const DATA = JSON.parse(TEXT);
const RHDI = DATA.variables.find((v) => v.id === "rhdi_per_person");
const PSNB = DATA.variables.find((v) => v.id === "psnb");

const respond = (body, status = 200) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

beforeEach(() => {
  resetForecastVintages();
  window.history.replaceState({}, "", "/?tab=forecasts");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderTab(props = {}) {
  vi.stubGlobal("fetch", respond(TEXT));
  const view = render(<ForecastVintagesTab {...props} />);
  await screen.findByRole("heading", { name: "OBR forecasts beside the outturn" });
  return view;
}

const svgText = (container) => [...container.querySelectorAll(".recharts-surface text")].map((t) => t.textContent);
const brushText = (container) => [...container.querySelectorAll(".recharts-brush-texts text")].map((t) => t.textContent);
const lines = (container) => container.querySelectorAll(".recharts-line");
const option = (name) => within(screen.getByRole("group", { name: "Chart options" })).getByRole("button", { name });
const gbp = (v) => `£${Math.round(v).toLocaleString("en-GB")}`;

describe("a forecasts file that cannot be shown", () => {
  it("says it is loading until the file is read", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ForecastVintagesTab />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading OBR forecasts…");
  });

  const withText = () => {
    const data = structuredClone(DATA);
    data.variables[0].level.outturn["2020"] = "1.2";
    return data;
  };
  it.each([
    ["missing", () => respond("", 404)],
    ["not JSON", () => respond("<html>")],
    ["with no variables", () => respond({ ...DATA, variables: [] })],
    ["with a value as text", () => respond(withText())],
  ])("is unavailable, never zero, when the file is %s", async (_name, fetcher) => {
    vi.stubGlobal("fetch", fetcher());
    const { container } = render(<ForecastVintagesTab />);
    expect(await screen.findByText("OBR forecasts are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/No figures are shown in its place/)).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeNull();
    expect(document.body.textContent).not.toMatch(/£|\d%/);
  });

  it("waits for a forecast after March 2026 to be checked before showing any", async () => {
    const data = structuredClone(DATA);
    const vintages = data.variables[0].level.vintages;
    vintages.push({ ...vintages[vintages.length - 1], id: "efo_later", label: "Later", year: 2026, month: 10 });
    vi.stubGlobal("fetch", respond(data));
    const { container } = render(<ForecastVintagesTab />);
    expect(await screen.findByText("OBR forecasts are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/holds a forecast after March 2026/)).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeNull();
  });
});

describe("the chart", () => {
  it("opens on real household disposable income per head, in £ a year", async () => {
    await renderTab();
    expect(screen.getByRole("heading", { level: 3, name: RHDI.label })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Measure: ${RHDI.label}` })).toBeInTheDocument();
    const units = within(screen.getByRole("group", { name: "Unit" })).getAllByRole("button");
    expect(units.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["£", "true"],
      ["Index", "false"],
      ["%", "false"],
    ]);
    expect(option("Earlier forecasts")).toHaveAttribute("aria-pressed", "true");
    expect(option("Full history")).toHaveAttribute("aria-pressed", "false");
    expect(option("Annual totals")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Quarterly annualised (×4)")).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=forecasts");
  });

  it("labels the start, latest and end points as the chart it is modelled on", async () => {
    const { container } = await renderTab();
    const text = svgText(container);
    for (const label of ["£25,820", "start", "£26,308", "latest", "£26,628", "end"]) expect(text).toContain(label);
    expect(text).toContain("£ per head a year (chained volume measure)");
  });

  it("draws the outturn, the March 2026 forecast and each earlier forecast; F hides the earlier ones", async () => {
    const { container } = await renderTab();
    expect(lines(container)).toHaveLength(1 + RHDI.level.vintages.length);
    const legend = container.querySelector(".chart-legend");
    expect(legend).toHaveTextContent("Outturn");
    expect(legend).toHaveTextContent("March 2026 forecast");
    expect(legend).toHaveTextContent("Earlier forecasts");
    fireEvent.click(option("Earlier forecasts"));
    expect(option("Earlier forecasts")).toHaveAttribute("aria-pressed", "false");
    expect(lines(container)).toHaveLength(2);
    expect(container.querySelector(".chart-legend")).not.toHaveTextContent("Earlier forecasts");
  });

  it("shows the recent window, and with H the whole history: Q1 1955 to Q1 2031", async () => {
    const { container } = await renderTab();
    const recent = brushText(container);
    expect(recent).toHaveLength(2);
    expect(recent[0]).not.toBe("Q1 1955");
    expect(recent[1]).toBe("Q1 2031");
    fireEvent.click(option("Full history"));
    expect(brushText(container)).toEqual(["Q1 1955", "Q1 2031"]);
    fireEvent.click(option("Full history"));
    expect(brushText(container)).toEqual(recent);
  });

  it("with A, totals each calendar year's four quarters", async () => {
    const { container } = await renderTab();
    fireEvent.click(option("Annual totals"));
    expect(option("Annual totals")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Quarterly annualised (×4)")).toBeNull();
    const y2024 = [1, 2, 3, 4].reduce((sum, q) => sum + RHDI.level.outturn[`2024Q${q}`], 0);
    expect(svgText(container)).toContain(gbp(y2024));
    expect(brushText(container)[1]).toBe("2030");
  });

  it("switches unit, keeping the options chosen", async () => {
    const { container } = await renderTab();
    fireEvent.click(option("Earlier forecasts"));
    fireEvent.click(within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { name: "%" }));
    expect(svgText(container)).toContain("% change on a year earlier");
    expect(option("Earlier forecasts")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { name: "Index" }));
    expect(svgText(container)).toContain("Index (Q2 2024 = 100)");
    expect(svgText(container)).toContain("100.0");
  });

  it("shows another measure, keeping it in the address", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: `Measure: ${RHDI.label}` }));
    fireEvent.click(screen.getByRole("option", { name: PSNB.label }));
    expect(screen.getByRole("heading", { level: 3, name: PSNB.label })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("psnb");
    expect(option("Annual totals")).toBeDisabled();
    expect(screen.queryByText("Quarterly annualised (×4)")).toBeNull();
    const units = within(screen.getByRole("group", { name: "Unit" })).getAllByRole("button");
    expect(units.map((b) => b.textContent)).toEqual(["£", "%"]);
  });

  it("opens the measure a link names", async () => {
    window.history.replaceState({}, "", "/?tab=forecasts&sub=cpi");
    await renderTab();
    const cpi = DATA.variables.find((v) => v.id === "cpi");
    expect(screen.getByRole("heading", { level: 3, name: cpi.label })).toBeInTheDocument();
  });

  it("draws every measure in every unit it offers", async () => {
    const { container } = await renderTab();
    for (const variable of DATA.variables) {
      fireEvent.click(screen.getByRole("button", { name: /^Measure: / }));
      fireEvent.click(screen.getByRole("option", { name: variable.label }));
      // A measure in one unit has no unit switch
      const group = screen.queryByRole("group", { name: "Unit" });
      for (const button of group ? within(group).getAllByRole("button") : [null]) {
        if (button) fireEvent.click(button);
        expect(container.querySelector(".publication-unavailable")).toBeNull();
        expect(lines(container).length).toBeGreaterThan(1);
      }
    }
  });
});

describe("the page's text", () => {
  it("says nothing tied to the Budget's date", async () => {
    await renderTab();
    const text = document.body.textContent;
    for (const pattern of [/pre-measures/i, /latest forecast/i, /pre-Budget/i, /28 October/, /candidate/i]) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("says where the outturn and forecasts come from, and how they were checked", async () => {
    await renderTab();
    expect(screen.getByText("Source: ONS (outturn), OBR (forecast)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(await screen.findByText(/^Outturn: ONS CRXX/)).toBeInTheDocument();
    expect(screen.getByText(/^Forecasts: OBR, Economic and fiscal outlook/)).toBeInTheDocument();
    expect(screen.getByText(/starts from the latest outturn it reaches, Q2 2026/)).toBeInTheDocument();
    expect(screen.getByText(/^From Q4 2023 to Q3 2025, the ONS outturn's % change on a year earlier is within 1\.5 percentage points/)).toBeInTheDocument();
  });

  it("lists every source file with its checksum", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    for (const source of DATA.meta.sources.obr) {
      expect(await screen.findByRole("link", { name: source.title })).toHaveAttribute("href", source.url);
    }
    for (const source of DATA.meta.sources.ons) {
      expect(screen.getByRole("link", { name: `${source.cdid} (${source.dataset})` })).toHaveAttribute("href", source.page);
    }
    expect(screen.getAllByText(DATA.meta.sources.obr[0].sha256.slice(0, 12))[0]).toHaveAttribute(
      "title",
      DATA.meta.sources.obr[0].sha256,
    );
  });

  it("lists what it leaves out", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: "What this view leaves out" }));
    for (const item of DATA.meta.left_out) expect(await screen.findByText(`${item.what}.`)).toBeInTheDocument();
    for (const gap of DATA.meta.gaps) expect(screen.getByText(gap)).toBeInTheDocument();
  });

  it("links to the forecast behind the living standards baseline", async () => {
    const onShowTab = vi.fn();
    await renderTab({ onShowTab });
    const link = screen.getByRole("link", { name: "Living standards: Forecast changes" });
    expect(link).toHaveAttribute("href", "?tab=living&sub=forecast");
    fireEvent.click(link);
    expect(onShowTab).toHaveBeenCalledWith("living", "forecast");
  });
});

describe("the chart's sentences", () => {
  it("name each forecast's start from the file's launch rules", () => {
    expect(startsSentence(DATA.meta.launch_rules, "calendar", false)).toBe(
      "Each dashed line is one OBR forecast, from its launch period: the calendar year before the forecast was published.",
    );
    expect(startsSentence({}, "calendar", false)).toBeNull();
    expect(startsSentence(DATA.meta.launch_rules, "quarterly", true)).toMatch(/last whole calendar year/);
  });

  it("name only the points drawn", () => {
    const view = buildView(DATA, RHDI, { unit: "level" });
    expect(pointsSentence(view)).toBe(
      "The labelled points are the outturn at the start of this parliament (Q2 2024), the latest outturn (Q2 2026) and the March 2026 forecast at the end of this parliament (Q2 2029).",
    );
    expect(pointsSentence({ ...view, points: view.points.slice(1, 2) })).toBe(
      "The labelled points are the latest outturn (Q2 2026).",
    );
    expect(pointsSentence({ ...view, points: [] })).toBeNull();
  });
});
