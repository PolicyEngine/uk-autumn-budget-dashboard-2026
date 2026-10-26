import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { DECILES_ANCHOR } from "./App";
import { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import { resetPresetResults } from "./utils/householdPresets";
import {
  DEEP_LINK_HASHES,
  DEEP_LINK_SCRIPT,
  householdFigure,
  measureCountFigure,
  netRevenueFigure,
  opensLanding,
} from "./utils/landing";
import { yearLabel } from "./utils/displayYears";
import { provisionalLabel } from "./utils/publication/manifest";
import { BASE_PATH, fixtureFetch, fixtureJson } from "./test/publicationFixture";

const INTRO =
  /^This dashboard uses PolicyEngine UK to show how Autumn Budget 2026 measures would affect the public finances and households: by income, area and age, and for your own household, alongside the OBR forecast\. Costings are our own; forecast: OBR, Economic and fiscal outlook – March 2026\.$/;

const BOXES = {
  society: /^What this Budget means for society/,
  household: /^What it means for your household/,
  policies: /^What is in this Budget/,
};

beforeEach(() => {
  resetPresetResults();
  const original = fixtureJson("manifest.json");
  const manifest = { ...original, measures: { alpha: original.measures.alpha }, combined: {} };
  const serve = fixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest) } });
  vi.stubGlobal("fetch", (url, init) => serve(`${BASE_PATH}${url}`, init));
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderApp() {
  const rendered = render(<App />);
  await screen.findByRole("tablist", { name: "Views" });
  await waitFor(() => expect(rendered.container.querySelector('.app[data-publication="verified"]')).not.toBeNull());
  return rendered;
}

const landing = () => screen.queryByRole("region", { name: "What Autumn Budget 2026 means" });
const box = (name) => screen.getByRole("link", { name: BOXES[name] });
const viewTab = (name) => within(screen.getByRole("tablist", { name: "Views" })).getByRole("tab", { name });
const selectedViewTabs = () =>
  within(screen.getByRole("tablist", { name: "Views" }))
    .getAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true");
const search = () => new URLSearchParams(window.location.search);

describe("the landing page", () => {
  it("shows at the bare address: the paragraph, then three boxes, with the tab bar and band above", async () => {
    const { container } = await renderApp();
    const page = landing();
    expect(page).not.toBeNull();
    expect(within(page).getByText(/^This dashboard uses/)).toHaveTextContent(INTRO);
    // The controls line is not repeated: the band shows them
    expect(container).not.toHaveTextContent("Choose a year and policies");
    expect(within(page).getAllByRole("link", { name: /^What/ }).map((link) => link.getAttribute("href"))).toEqual([
      "?tab=dashboard&sub=finances",
      "?tab=household",
      "?tab=policies",
    ]);
    // The tab bar stays, with no view chosen (no notch into a sub-tab
    // band); its first tab is the Tab stop
    expect(selectedViewTabs()).toEqual([]);
    expect(container.querySelector(".view-tabs-bar")).not.toHaveClass("has-notch");
    expect(container.querySelector(".app")).not.toHaveAttribute("data-sub-band");
    expect(viewTab("Population impact")).toHaveAttribute("tabindex", "0");
    // Both pills apply: the boxes' figures follow them
    const band = container.querySelector(".title-row");
    for (const pill of [".band-year", ".band-policy"]) {
      expect(band.querySelector(pill)).not.toHaveClass("is-hidden");
      expect(band.querySelector(pill)).not.toHaveAttribute("inert");
    }
    // Nothing is written to the address
    expect(window.location.search).toBe("");
  });

  it("shows each box's live figure from the publication, and none it cannot read", async () => {
    await renderApp();
    // The fixture publishes one measure
    expect(box("policies").querySelector(".landing-box-figure")).toHaveTextContent(/^1 measure$/);
    expect(box("policies").querySelector(".landing-box-figure-value")).toHaveTextContent(/^1$/);
    // Each box ends in a clear way in
    for (const name of Object.keys(BOXES)) expect(box(name)).toHaveTextContent(/Explore→$/);
    // The fixture has no household_presets.json: no figure, the box still shows
    expect(box("household").querySelector(".landing-box-figure")).toBeNull();
    // Public finances: the selection's net change in the band's year, and
    // nothing when that year is not published (the fixture's measure has
    // no 2027-28 figure; netRevenueFigure's own test covers the wording)
    expect(box("society").querySelector(".landing-box-figure")).toBeNull();
    expect(box("society")).toHaveTextContent(/^What this Budget means for society/);
  });

  it("keeps the provisional caveat in one place: a small badge on the landing page, none over the views", async () => {
    const original = fixtureJson("manifest.json");
    const manifest = {
      ...original,
      measures: { alpha: { ...original.measures.alpha, status: "provisional" } },
      combined: {},
    };
    const serve = fixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest) } });
    vi.stubGlobal("fetch", (url, init) => serve(`${BASE_PATH}${url}`, init));
    const { container } = await renderApp();
    const notes = () => container.querySelectorAll(".publication-provisional");
    // Once, on the landing page, under the paragraph, in the manifest's
    // own wording (provisionalLabel)
    expect(notes()).toHaveLength(1);
    expect(landing().querySelector(".publication-provisional")).toHaveTextContent(provisionalLabel(manifest));
    // Not over any view
    fireEvent.click(box("policies"));
    expect(notes()).toHaveLength(0);
  });

  it("puts the live Public finances view behind it, faded and out of reach", async () => {
    const { container } = await renderApp();
    const behind = container.querySelector(".view-panels");
    expect(container.querySelector(".view-stage")).toHaveClass("is-landing");
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");
    // The real view: its sub-tabs at Public finances, hidden from the
    // accessibility tree
    expect(within(behind).getByText("Public finances", { selector: ".sub-tab, .sub-tab *" })).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Population impact sections" })).toBeNull();
    // Leaving the landing page brings it forward
    fireEvent.click(box("society"));
    expect(container.querySelector(".view-stage")).not.toHaveClass("is-landing");
    expect(behind).not.toHaveAttribute("inert");
    expect(behind).not.toHaveAttribute("aria-hidden");
  });

  it("opens Population impact at Public finances from the first box", async () => {
    await renderApp();
    fireEvent.click(box("society"));
    expect(landing()).toBeNull();
    expect(viewTab("Population impact")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Public finances" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Public finances" })).toBeInTheDocument();
    expect([search().get("tab"), search().get("sub")]).toEqual(["dashboard", "finances"]);
  });

  it("opens Household impact from the second box", async () => {
    await renderApp();
    fireEvent.click(box("household"));
    expect(landing()).toBeNull();
    expect(viewTab("Household impact")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Household impact" })).toBeInTheDocument();
    expect([search().get("tab"), search().get("sub")]).toEqual(["household", null]);
  });

  it("opens Policies from the third box", async () => {
    await renderApp();
    fireEvent.click(box("policies"));
    expect(landing()).toBeNull();
    expect(viewTab("Policies")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Policies" })).toBeInTheDocument();
    expect(search().get("tab")).toBe("policies");
  });

  it("leaves for whichever view the tab bar chooses", async () => {
    await renderApp();
    fireEvent.click(viewTab("OBR forecast"));
    expect(landing()).toBeNull();
    expect(viewTab("OBR forecast")).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe("outlook");
  });

  it("leaves by the keyboard from the tab bar's first tab", async () => {
    await renderApp();
    fireEvent.keyDown(screen.getByRole("tablist", { name: "Views" }), { key: "ArrowRight" });
    expect(landing()).toBeNull();
    expect(viewTab("Population impact")).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe("dashboard");
  });

  it.each([
    ["/?tab=dashboard", "Population impact"],
    ["/?tab=household", "Household impact"],
    ["/?tab=policies", "Policies"],
    ["/?sub=all", "Population impact"],
    ["/?policies=alpha", "Population impact"],
    ["/?year=2028", "Population impact"],
    [`/#${DECILES_ANCHOR}`, "Population impact"],
    [`/#${YOUNG_PEOPLE_ANCHOR}`, "Population impact"],
  ])("does not show for a link to a view: %s", async (url, view) => {
    window.history.replaceState({}, "", url);
    const { container } = await renderApp();
    expect(landing()).toBeNull();
    expect(container.querySelector(".view-panels")).not.toHaveAttribute("inert");
    expect(viewTab(view)).toHaveAttribute("aria-selected", "true");
  });
});

describe("the landing page's rules", () => {
  it("opens only at an address with no view, selection or section in it", () => {
    expect(opensLanding({ search: "", hash: "" })).toBe(true);
    expect(opensLanding({ search: "?utm_source=x", hash: "#top" })).toBe(true);
    for (const search of ["?tab=outlook", "?sub=all", "?policies=", "?year=2028"]) {
      expect(opensLanding({ search, hash: "" })).toBe(false);
    }
    expect(opensLanding({ search: "", hash: "#deciles" })).toBe(false);
    expect(opensLanding({ search: "", hash: "#young-people" })).toBe(false);
    // The hashes are the sections' own anchors
    expect(DEEP_LINK_HASHES).toEqual([`#${YOUNG_PEOPLE_ANCHOR}`, `#${DECILES_ANCHOR}`]);
  });

  it("marks a link to a view before the first paint, with the same rule", () => {
    const run = (search, hash) => {
      const attributes = {};
      const document = { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } };
      new Function("window", "document", DEEP_LINK_SCRIPT)({ location: { search, hash } }, document);
      return "data-deep-link" in attributes;
    };
    for (const [search, hash] of [["", ""], ["?tab=policies", ""], ["?year=2028", ""], ["", "#deciles"], ["?x=1", "#other"]]) {
      expect(run(search, hash)).toBe(!opensLanding({ search, hash }));
    }
  });

  it("writes the Public finances figure from the published net change only", () => {
    const data = [
      { year: 2026, netImpact: 0.04 },
      { year: 2027, netImpact: -8.84 },
      { year: 2028, netImpact: 2.25 },
      { year: 2029, netImpact: null },
    ];
    expect(netRevenueFigure(data, 2027, yearLabel)).toEqual({
      value: "−£8.8bn", context: "change in government revenue, 2027-28", tone: "loss",
    });
    expect(netRevenueFigure(data, 2028, yearLabel)).toMatchObject({ value: "+£2.3bn", tone: "gain" });
    expect(netRevenueFigure(data, 2026, yearLabel)).toMatchObject({ value: "£0.0bn", tone: "neutral" });
    // Not fully published, or not there: no figure
    expect(netRevenueFigure(data, 2029, yearLabel)).toBeNull();
    expect(netRevenueFigure(data, 2031, yearLabel)).toBeNull();
    expect(netRevenueFigure(undefined, 2027, yearLabel)).toBeNull();
  });

  it("writes the household figure from the example's change, and counts the measures", () => {
    const who = "a 22-year-old renting";
    expect(householdFigure(88.4, who)).toEqual({ value: "+£88", context: `a year for ${who}`, tone: "gain" });
    expect(householdFigure(-1234, who)).toMatchObject({ value: "−£1,234", tone: "loss" });
    expect(householdFigure(0.3, who)).toEqual({ value: "No change", context: `for ${who}`, tone: "neutral" });
    expect(householdFigure(undefined, who)).toBeNull();
    expect(measureCountFigure(9)).toEqual({ value: "9", context: "measures", tone: "neutral" });
    expect(measureCountFigure(1)).toMatchObject({ value: "1", context: "measure" });
    expect(measureCountFigure(0)).toBeNull();
  });
});
