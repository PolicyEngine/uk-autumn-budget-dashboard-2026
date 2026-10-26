/**
 * The forecast vintages view on the committed file
 * (public/data/obr_forecast_vintages.json), and on files it must refuse:
 * a view whose data cannot be shown says so and shows no figure. The last
 * cases mount it as another view's sub-tab, as Pre-measures forecast holds
 * it; livingStandards/OutlookVintages.test.jsx has it in the page.
 */
import { readFileSync } from "node:fs";
import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import fc from "fast-check";
import ForecastVintagesView, { cardNotes, csvFigure, drawnNote, pointsSentence, startsSentence, vintageCsv } from "./ForecastVintagesView";
import { earliestForecast, forecastVintagesProblem, resetForecastVintages } from "../../utils/forecastVintages/load";
import { periodIndex, toSeries } from "../../utils/forecastVintages/transforms";
import { GROWTH_AXIS, buildView, pointsIn } from "../../utils/forecastVintages/view";

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
  window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderView(props = {}) {
  vi.stubGlobal("fetch", respond(TEXT));
  const view = render(<ForecastVintagesView {...props} />);
  await screen.findByRole("heading", { name: "OBR forecasts beside the outturn" });
  return view;
}

const svgText = (container) => [...container.querySelectorAll(".recharts-surface text")].map((t) => t.textContent);
const brushText = (container) => [...container.querySelectorAll(".recharts-brush-texts text")].map((t) => t.textContent);
const lines = (container) => container.querySelectorAll(".recharts-line");
const option = (name) => within(screen.getByRole("group", { name: "Chart options" })).getByRole("button", { name });
// What a button's tip (Tip) says on hover; none open after
function tipOf(button) {
  fireEvent.mouseEnter(button);
  const text = screen.getByRole("tooltip").textContent;
  fireEvent.mouseLeave(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  return text;
}
const gbp = (v) => `£${Math.round(v).toLocaleString("en-GB")}`;

describe("a forecasts file that cannot be shown", () => {
  it("says it is loading until the file is read", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ForecastVintagesView />);
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
    const { container } = render(<ForecastVintagesView />);
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
    const { container } = render(<ForecastVintagesView />);
    expect(await screen.findByText("OBR forecasts are unavailable")).toBeInTheDocument();
    expect(screen.getByText(/holds a forecast after March 2026/)).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeNull();
  });
});

describe("the chart", () => {
  it("opens on real household disposable income per head, in £ a year", async () => {
    await renderView();
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
    expect(window.location.search).toBe("?tab=outlook&sub=vintages");
  });

  // Found by the thirteenth review: a % change's button kept the file's
  // axis, "% of GDP", on hover, under a chart that says what it is
  it("names each unit's button as its axis, as the chart would draw it", async () => {
    await renderView();
    const titles = () => within(screen.getByRole("group", { name: "Unit" })).getAllByRole("button").map(tipOf);
    expect(titles()).toEqual([RHDI.units.level.axis, "Index (Q2 2024 = 100)", GROWTH_AXIS]);
    fireEvent.click(option("Annual totals"));
    expect(titles()[1]).toBe("Index (2024 = 100)");
    cleanup();
    resetForecastVintages();
    const data = structuredClone(DATA);
    Object.assign(data.variables.find((v) => v.id === "receipts").units.pct, { from: "level", transform: "growth" });
    vi.stubGlobal("fetch", respond(data));
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=receipts");
    render(<ForecastVintagesView />);
    const percent = await screen.findByRole("button", { name: "%" });
    expect(tipOf(percent)).toBe(GROWTH_AXIS);
    fireEvent.click(percent);
    expect(screen.getByRole("button", { name: "%" })).toHaveAttribute("aria-pressed", "true");
    expect(svgText(document.body)).toContain(GROWTH_AXIS);
  });

  it("labels the start, latest and end points as the chart it is modelled on", async () => {
    const { container } = await renderView();
    const text = svgText(container);
    for (const label of ["£25,820", "start", "£26,308", "latest", "£26,628", "end"]) expect(text).toContain(label);
    expect(text).toContain("£ per head a year (chained volume measure)");
  });

  it("draws every leader line under every label's text", async () => {
    const { container } = await renderView();
    const parts = [...container.querySelectorAll(".fv-point-line, .fv-point-label")];
    expect(parts.map((el) => `${el.classList.contains("fv-point-line") ? "line" : "text"} ${el.dataset.role}`)).toEqual([
      "line start",
      "line latest",
      "line end",
      "text start",
      "text latest",
      "text end",
    ]);
    // One dot for each point, not one for its line and another for its text
    expect(container.querySelectorAll(".recharts-reference-dot circle")).toHaveLength(3);
  });

  it("draws the outturn, the March 2026 forecast and each earlier forecast; F hides the earlier ones", async () => {
    const { container } = await renderView();
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
    const { container } = await renderView();
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
    const { container } = await renderView();
    fireEvent.click(option("Annual totals"));
    expect(option("Annual totals")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Quarterly annualised (×4)")).toBeNull();
    const y2024 = [1, 2, 3, 4].reduce((sum, q) => sum + RHDI.level.outturn[`2024Q${q}`], 0);
    expect(svgText(container)).toContain(gbp(y2024));
    expect(brushText(container)[1]).toBe("2030");
  });

  it("switches unit, keeping the options chosen", async () => {
    const { container } = await renderView();
    fireEvent.click(option("Earlier forecasts"));
    fireEvent.click(within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { name: "%" }));
    expect(svgText(container)).toContain("% change on a year earlier");
    expect(option("Earlier forecasts")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(screen.getByRole("group", { name: "Unit" })).getByRole("button", { name: "Index" }));
    expect(svgText(container)).toContain("Index (Q2 2024 = 100)");
    expect(svgText(container)).toContain("100.0");
  });

  it("shows another measure, keeping it in the address", async () => {
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: `Measure: ${RHDI.label}` }));
    fireEvent.click(screen.getByRole("option", { name: PSNB.label }));
    expect(screen.getByRole("heading", { level: 3, name: PSNB.label })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("variable")).toBe("psnb");
    // A disabled toggle's name says why, for a reader who cannot hover it;
    // so does its tip. The others' tips say what they are
    const annual = option("Annual totals: this measure is already annual");
    expect(annual).toBeDisabled();
    expect(tipOf(annual)).toBe("Annual totals: this measure is already annual");
    expect(tipOf(option("Earlier forecasts"))).toBe("Earlier forecasts");
    expect(option("Earlier forecasts")).not.toHaveAttribute("title");
    expect(screen.queryByText("Quarterly annualised (×4)")).toBeNull();
    const units = within(screen.getByRole("group", { name: "Unit" })).getAllByRole("button");
    expect(units.map((b) => b.textContent)).toEqual(["£", "%"]);
  });

  it("opens the measure a link names", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=cpi");
    await renderView();
    const cpi = DATA.variables.find((v) => v.id === "cpi");
    expect(screen.getByRole("heading", { level: 3, name: cpi.label })).toBeInTheDocument();
  });

  it("draws every measure in every unit it offers", async () => {
    const { container } = await renderView();
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
    await renderView();
    const text = document.body.textContent;
    for (const pattern of [/pre-measures/i, /latest forecast/i, /pre-Budget/i, /28 October/, /candidate/i]) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("says where the outturn and forecasts come from, and how they were checked", async () => {
    await renderView();
    expect(screen.getByText("Source: ONS (outturn), OBR (forecast)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(await screen.findByText(/^Outturn: ONS CRXX/)).toBeInTheDocument();
    expect(screen.getByText(/^Forecasts: OBR, Economic and fiscal outlook/)).toBeInTheDocument();
    expect(screen.getByText(/starts from the latest outturn it reaches, Q2 2026/)).toBeInTheDocument();
    // The March 2026 forecast is re-anchored, so the launch periods are the
    // earlier forecasts' only
    expect(screen.getByText(/^Each earlier forecast's dashed line starts at its launch period/)).toBeInTheDocument();
    expect(screen.getByText(/^From Q4 2023 to Q3 2025, the ONS outturn's % change on a year earlier is within 1\.5 percentage points/)).toBeInTheDocument();
  });

  it("lists every source file with its checksum", async () => {
    await renderView();
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

  it("says where the lines start only for the lines drawn", async () => {
    await renderView();
    fireEvent.click(option("Earlier forecasts"));
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(await screen.findByText(/starts from the latest outturn it reaches, Q2 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/launch period/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/in the period it was made|drawn from the period/);
  });

  it("names an earlier forecast it cannot draw", async () => {
    const data = JSON.parse(TEXT);
    const gdp = data.variables.find((v) => v.id === "real_gdp");
    // No outturn to 2009, the launch period of the two 2010 forecasts (an
    // outturn that starts later is a file the loader accepts)
    for (const period of Object.keys(gdp.level.outturn)) if (Number(period) <= 2009) delete gdp.level.outturn[period];
    vi.stubGlobal("fetch", respond(data));
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=real_gdp");
    render(<ForecastVintagesView />);
    fireEvent.click(await screen.findByRole("button", { name: "About this chart" }));
    expect(
      await screen.findByText("June 2010 and November 2010 forecasts cannot be drawn in this view, so they are left out."),
    ).toBeInTheDocument();
  });

  it("lists what it leaves out", async () => {
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: "What this view leaves out" }));
    for (const item of DATA.meta.left_out) expect(await screen.findByText(`${item.what}.`)).toBeInTheDocument();
    for (const gap of DATA.meta.gaps) expect(screen.getByText(gap)).toBeInTheDocument();
  });

});

describe("the chart's sentences", () => {
  it("name each forecast's start from the file's launch rules", () => {
    const rules = DATA.meta.launch_rules;
    expect(startsSentence(rules, "calendar", false)).toBe(
      "Each forecast's dashed line starts at its launch period, or where its figures start if that is later. The launch period is the calendar year before the forecast was published.",
    );
    expect(startsSentence(rules, "calendar", false, { earlier: false })).toMatch(/^The forecast's dashed line/);
    expect(startsSentence({}, "calendar", false)).toBeNull();
    expect(startsSentence(rules, "quarterly", true)).toMatch(/last whole calendar year/);
  });

  it("leave a re-anchored newest forecast to its own note", () => {
    const rules = DATA.meta.launch_rules;
    expect(startsSentence(rules, "quarterly", false, { reanchored: true })).toMatch(/^Each earlier forecast's dashed line/);
    expect(startsSentence(rules, "quarterly", false, { reanchored: true, earlier: false })).toBeNull();
  });

  it("are true of the committed lines: an earlier forecast starts at its launch period or later", () => {
    for (const variable of DATA.variables) {
      for (const unit of Object.keys(variable.units)) {
        const view = buildView(DATA, variable, { unit });
        for (const v of view.vintages) {
          const launch = periodIndex(view.measure.vintages.find((x) => x.id === v.id).launch, variable.frequency);
          expect(Math.min(...v.values.keys())).toBeGreaterThanOrEqual(v.anchor);
          if (v.newest && v.reanchored) expect(v.anchor).toBeGreaterThan(launch);
          else expect(v.anchor).toBe(launch);
        }
      }
    }
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

  it("name only the points in the periods the brush shows", () => {
    const view = buildView(DATA, RHDI, { unit: "level" });
    const before2024 = view.rows.filter((r) => r.x < view.start);
    expect(pointsSentence(view, pointsIn(view.points, before2024))).toBeNull();
    const toLatest = view.rows.filter((r) => r.x <= view.points.find((p) => p.role === "latest").x);
    expect(pointsSentence(view, pointsIn(view.points, toLatest))).toBe(
      "The labelled points are the outturn at the start of this parliament (Q2 2024) and the latest outturn (Q2 2026).",
    );
  });
});

describe("what the notes say of the lines drawn", () => {
  const byId = (id) => DATA.variables.find((v) => v.id === id);
  const noteOf = (id, options) => {
    const view = buildView(DATA, byId(id), options);
    return drawnNote(view.measure.kind, view);
  };
  const GROWTH =
    "The OBR forecasts this measure as growth, so each forecast's line starts on the outturn and grows at that forecast's rates.";
  const INDEX =
    "The OBR forecasts this measure as an index, so each forecast's line starts on the outturn and moves with that forecast's index.";

  it("say a forecast of levels is drawn as the OBR published it only in its own unit", () => {
    expect(noteOf("employment", { unit: "level" })).toBe("Each forecast is drawn as the OBR published it.");
    expect(noteOf("employment", { unit: "index" })).toBe(
      "Each forecast is the OBR's published figures, shown as an index of the outturn at the start of this parliament.",
    );
    expect(noteOf("employment", { unit: "pct" })).toBe(
      "Each forecast is the OBR's published figures, shown as the % change on a year earlier.",
    );
    expect(noteOf("psnb", { unit: "pct" })).toBe("Each forecast is drawn as the OBR published it.");
  });

  it("say how a forecast of growth or an index is carried on, then what the unit does to it", () => {
    expect(noteOf("real_gdp", { unit: "level" })).toBe(GROWTH);
    expect(noteOf("real_gdp", { unit: "pct" })).toBe(`${GROWTH} Each line is then shown as the % change on a year earlier.`);
    expect(noteOf("real_gdp", { unit: "index" })).toBe(
      `${GROWTH} Each line is then shown as an index of the outturn at the start of this parliament.`,
    );
    expect(noteOf("rhdi_per_person", { unit: "level" })).toBe(`${INDEX} Each line is then shown at an annual rate (times four).`);
    expect(noteOf("rhdi_per_person", { unit: "level", annual: true })).toBe(
      `${INDEX} Each line is then shown as calendar-year totals.`,
    );
    expect(noteOf("rhdi_per_person", { unit: "index", annual: true })).toBe(
      `${INDEX} Each line is then shown as calendar-year totals, then as an index of the outturn at the start of this parliament.`,
    );
  });

  it("are true: 'as the OBR published it' only where every value drawn is the published one", () => {
    let published = 0;
    for (const variable of DATA.variables) {
      for (const unit of Object.keys(variable.units)) {
        for (const annual of variable.frequency === "quarterly" ? [false, true] : [false]) {
          for (const showPast of [true, false]) {
            const view = buildView(DATA, variable, { unit, annual, showPast });
            expect(view.unavailable).toBeNull();
            const note = drawnNote(view.measure.kind, view);
            const asPublished = view.vintages.every((v) => {
              const file = toSeries(view.measure.vintages.find((x) => x.id === v.id).values, variable.frequency);
              return [...v.values].every(([t, y]) => file.get(t) === y);
            });
            const where = `${variable.id} ${unit}${annual ? " A" : ""}${showPast ? "" : " F off"}`;
            if (note === "Each forecast is drawn as the OBR published it.") {
              published += 1;
              expect(asPublished, where).toBe(true);
            } else {
              expect(note, where).not.toMatch(/as the OBR published it/);
            }
          }
        }
      }
    }
    // Every native unit of a forecast of levels says so
    expect(published).toBeGreaterThan(0);
  });

  it("put the times-four note on a quarterly £ view only when its unit is annualised", () => {
    const times4 = /each quarter's amount is shown at an annual rate \(times four\)/;
    const notesOf = (variable, unit) => cardNotes(variable, buildView(DATA, variable, { unit }), { showPast: true });
    expect(notesOf(RHDI, "level").some((n) => times4.test(n))).toBe(true);
    expect(notesOf(RHDI, "index").some((n) => times4.test(n))).toBe(false);
    const plain = structuredClone(RHDI);
    delete plain.units.level.annualise;
    expect(notesOf(plain, "level").some((n) => times4.test(n))).toBe(false);
    for (const variable of DATA.variables.filter((v) => v.frequency !== "quarterly")) {
      for (const unit of Object.keys(variable.units)) expect(notesOf(variable, unit).some((n) => times4.test(n))).toBe(false);
    }
  });

  it("name the earliest forecast in the file in the subtitle", async () => {
    await renderView();
    expect(earliestForecast(DATA)).toBe("June 2010");
    expect(screen.getByText(/^The OBR's forecasts from June 2010 to March 2026, beside the ONS outturn\./)).toBeInTheDocument();
    cleanup();
    resetForecastVintages();
    const later = JSON.parse(TEXT);
    for (const variable of later.variables) {
      for (const measure of [variable.level, variable.share].filter(Boolean)) {
        measure.vintages = measure.vintages.filter((v) => v.year > 2010);
      }
    }
    vi.stubGlobal("fetch", respond(later));
    render(<ForecastVintagesView />);
    expect(await screen.findByText(/^The OBR's forecasts from March 2011 to March 2026/)).toBeInTheDocument();
  });
});

describe("the CSV download", () => {
  it("has a row per period shown, blank where a series has no value, and only the ONS's and OBR's figures", () => {
    const view = buildView(DATA, RHDI, { unit: "level" });
    const rows = view.rows.slice(view.windowStart);
    const text = vintageCsv({ title: RHDI.label, units: view.axisLabel, view, rows, notes: ["A note."] });
    const lines = text.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(`# ${RHDI.label}: OBR forecasts and ONS outturn`);
    // Quoted, as the source line holds a comma
    expect(lines[1]).toBe('"# Units: £ per head a year (chained volume measure) | Source: ONS (outturn), OBR (forecast)"');
    expect(lines[2].split(",")).toEqual(["Period", "Outturn", ...view.vintages.map((v) => `${v.label} forecast`)]);
    const body = lines.slice(3, 3 + rows.length);
    expect(body).toHaveLength(rows.length);
    expect(body[0].split(",")[0]).toBe(view.label(rows[0].x));
    // Q2 2024: the outturn at the start, ×4, as the chart shows it
    const start = body.find((line) => line.startsWith("Q2 2024,"));
    expect(Math.round(Number(start.split(",")[1]))).toBe(25820);
    // Q2 2029: the March 2026 forecast's end, in the last column
    const end = body.find((line) => line.startsWith("Q2 2029,")).split(",");
    expect(Math.round(Number(end[end.length - 1]))).toBe(26628);
    // A forecast made later has no value for an earlier period: blank, not 0
    const first = body[0].split(",");
    expect(first.slice(2).every((cell) => cell === "")).toBe(true);
    expect(text).not.toMatch(/PolicyEngine/);
    expect(lines[lines.length - 1]).toBe("# A note.");
  });

  const body = (text, view) =>
    text
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .slice(3, 3 + view.rows.length)
      .map((line) => line.split(","));

  // Found by the thirteenth review: four decimals wrote a figure the chart
  // draws, an index of a small level, as 0
  it("writes a figure the chart draws however small, never as 0", () => {
    const data = structuredClone(DATA);
    const receipts = data.variables.find((v) => v.id === "receipts");
    receipts.level.vintages.at(-1).values["2030-31"] = 0.0001;
    expect(forecastVintagesProblem(data)).toBeNull();
    // Index, F off
    const view = buildView(data, receipts, { unit: "index", showPast: false });
    const newest = view.vintages.at(-1);
    const row = view.rows.find((r) => r.x === periodIndex("2030-31", "fiscal"));
    expect(row[newest.key]).toBeGreaterThan(0);
    expect(row[newest.key]).toBeLessThan(0.0001);
    const text = vintageCsv({ title: receipts.label, units: view.axisLabel, view, rows: view.rows });
    const cells = body(text, view).find((line) => line[0] === "2030-31");
    const written = Number(cells.at(-1));
    expect(written).not.toBe(0);
    expect(Math.abs(written - row[newest.key])).toBeLessThanOrEqual(1e-11 * row[newest.key]);
  });

  it("reads each figure back to within a hundred-billionth of it, at any scale", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e15, max: 1e15 }), (v) => {
        const back = Number(csvFigure(v));
        expect(Math.abs(back - v)).toBeLessThanOrEqual(1e-11 * Math.abs(v));
        expect(back === 0).toBe(v === 0);
      }),
      { numRuns: 2000, examples: [[8.767784354590242e-6], [0.30000000000000004], [-0], [5e-324], [-1e15], [296673.4739770459]] },
    );
    expect(csvFigure(0.30000000000000004)).toBe("0.3");
    expect(csvFigure(-0)).toBe("0");
    expect([null, undefined, NaN].map(csvFigure)).toEqual(["", "", ""]);
  });

  it("writes every figure of every committed view as the chart draws it, and a blank for none", () => {
    let figures = 0;
    for (const variable of DATA.variables) {
      for (const unit of Object.keys(variable.units)) {
        for (const annual of variable.frequency === "quarterly" ? [false, true] : [false]) {
          const view = buildView(DATA, variable, { unit, annual });
          if (view.unavailable) continue;
          const keys = ["outturn", ...view.vintages.map((v) => v.key)];
          const rows = body(vintageCsv({ title: variable.label, units: view.axisLabel, view, rows: view.rows }), view);
          view.rows.forEach((row, i) => {
            keys.forEach((k, j) => {
              const cell = rows[i][1 + j];
              if (row[k] == null) return expect(cell).toBe("");
              figures += 1;
              expect(Math.abs(Number(cell) - row[k]), `${variable.id} ${unit} ${k}`).toBeLessThanOrEqual(1e-11 * Math.abs(row[k]));
            });
          });
        }
      }
    }
    expect(figures).toBeGreaterThan(10000);
  });
});

describe("as another view's sub-tab", () => {
  const SIBLING = { href: "?tab=outlook&sub=forecast", label: "Forecast changes" };
  const choose = (variable) => {
    fireEvent.click(screen.getByRole("button", { name: /^Measure: / }));
    fireEvent.click(screen.getByRole("option", { name: variable.label }));
  };
  const heading = (variable) => screen.getByRole("heading", { level: 3, name: variable.label });

  it("keeps the measure in ?variable=, leaving the holding view's ?sub= alone", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
    await renderView({ related: SIBLING });
    expect(window.location.search).toBe("?tab=outlook&sub=vintages");
    choose(PSNB);
    expect(window.location.search).toBe("?tab=outlook&sub=vintages&variable=psnb");
    choose(RHDI);
    expect(window.location.search).toBe("?tab=outlook&sub=vintages");
  });

  it("takes ?variable= out of the address while hidden, and puts it back when shown", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
    const { rerender } = await renderView({ related: SIBLING });
    choose(PSNB);
    rerender(<ForecastVintagesView active={false} related={SIBLING} />);
    expect(window.location.search).toBe("?tab=outlook&sub=vintages");
    rerender(<ForecastVintagesView active related={SIBLING} />);
    expect(heading(PSNB)).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook&sub=vintages&variable=psnb");
  });

  it("opens the measure a link brings when shown again", async () => {
    const cpi = DATA.variables.find((v) => v.id === "cpi");
    window.history.replaceState({}, "", "/?tab=outlook");
    const { rerender } = await renderView({ active: false, related: SIBLING });
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=cpi");
    rerender(<ForecastVintagesView active related={SIBLING} />);
    expect(heading(cpi)).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook&sub=vintages&variable=cpi");
  });

  it("opens the default for a measure it does not have, and writes nothing", async () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages&variable=nonsense");
    await renderView({ related: SIBLING });
    expect(heading(RHDI)).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=outlook&sub=vintages");
  });

  it("links to the sibling it is given, or to nothing", async () => {
    const onShow = vi.fn();
    const { unmount } = await renderView({ related: { ...SIBLING, onShow } });
    const link = screen.getByRole("link", { name: "Forecast changes" });
    expect(link).toHaveAttribute("href", "?tab=outlook&sub=forecast");
    fireEvent.click(link);
    expect(onShow).toHaveBeenCalledTimes(1);
    unmount();
    await renderView({});
    expect(screen.queryByText(/forecast behind PolicyEngine's living standards baseline/)).toBeNull();
  });

  it("lets the browser follow the link when it is given no way to show the sibling", async () => {
    await renderView({ related: SIBLING });
    const link = screen.getByRole("link", { name: "Forecast changes" });
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

  it("leaves a click that opens a new tab or window to the browser", async () => {
    const onShow = vi.fn();
    await renderView({ related: { ...SIBLING, onShow } });
    const link = screen.getByRole("link", { name: "Forecast changes" });
    let prevented = null;
    const follow = (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", follow);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      prevented = null;
      fireEvent.click(link, init);
      expect(prevented, JSON.stringify(init)).toBe(false);
    }
    expect(onShow).not.toHaveBeenCalled();
    // A plain click still shows the sibling in place
    fireEvent.click(link);
    expect(prevented).toBe(true);
    document.removeEventListener("click", follow);
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
