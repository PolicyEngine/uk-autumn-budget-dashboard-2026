import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GrowthWithMeasuresCard, { WITH_MEASURES_TITLE, clearGrowthWithMeasuresCache } from "./GrowthWithMeasuresCard";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";
import { MeasureCatalogueProvider } from "../../utils/measureCatalogue";
import { selectionNotPublished } from "../../utils/geography/selection";

const PUBLIC = join(__dirname, "..", "..", "..", "public", "data");
const OUTLOOK = readFileSync(join(PUBLIC, "living_standards_outlook.json"), "utf8");
// A frozen copy of the candidates' file (four of its runs), not public/data's:
// Budget day's --published-package run rewrites that file with the announced
// measures only, which would fail these tests on every publish PR (rehearsal
// of 27 October)
const FILE = readFileSync(join(__dirname, "..", "..", "test", "fixtures", "flat", "income_growth_with_measures.csv"), "utf8");
let GROWTH = FILE;

// The manifest's measures and its one combined run: exactly the pair
// (#228). No run is published for the pair with road_fuel_vat_cut.
const PAIR = ["plan_2_threshold_unfreeze", "threshold_freeze_2031_32"];
const KEY = "combined--plan_2_threshold_unfreeze+threshold_freeze_2031_32";
const approved = { status: "approved", outputs_sha256: "a".repeat(64) };
const catalogue = {
  displayable: [...PAIR, "road_fuel_vat_cut"].map((id) => ({ id })),
  combinedId: null,
  manifest: {
    measures: Object.fromEntries([...PAIR, "road_fuel_vat_cut"].map((id) => [id, approved])),
    combined: {
      [KEY]: { status: "approved", measures: PAIR, member_outputs_sha256: Object.fromEntries(PAIR.map((id) => [id, "a".repeat(64)])) },
    },
  },
};
const notPublished = selectionNotPublished("Growth");
const withCatalogue = ({ children }) => <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;

beforeEach(() => {
  GROWTH = FILE;
  clearGrowthWithMeasuresCache();
  clearOutlookCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).endsWith("living_standards_outlook.json")) return new Response(OUTLOOK, { status: 200 });
      if (String(url).endsWith("income_growth_with_measures.csv")) return new Response(GROWTH, { status: 200 });
      return new Response("", { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Growth across the distribution, with the selected measures", () => {
  it("opens on growth with the policies; its effect in pp is labelled with the measures, with a link to its twin", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32"]} twinLink={<a href="?tab=outlook&sub=living">twin</a>} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Options:.*Growth with the policies \(%\)/ })).toBeTruthy();
    expect(document.querySelector(".chart-description").textContent).toMatch(/^With the selected policies, real incomes/);
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Effect (pp)" }));
    // The header holds only the twin link; "with the measures" is in About
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText(/with the policies less without them, in percentage points/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "twin" })).toBeTruthy();
    expect(screen.getAllByText(/Effect \(pp\)/).length).toBeGreaterThan(0);
    const sentence = document.querySelector(".chart-description").textContent;
    expect(sentence).toMatch(/^The policies (barely )?change income growth/);
    // The years behind it named, in pp as the axis (round 3)
    expect(sentence).toMatch(/(on average over|from) \d{4}-\d{2} to \d{4}-\d{2}/);
    expect(sentence).toMatch(/pp/);
    expect(sentence).not.toMatch(/ points/);
  });

  it("names the two views by what they plot, and starts the growth view's sentence with the policies (LS1, LS3)", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32"]} twinLink={null} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    expect(document.querySelector(".chart-description").textContent).toMatch(/^With the selected policies, real incomes .+ \(lowest tenth: \S+% a year; top tenth: \S+%\)\.$/);
    expect(document.querySelector(".chart-description").textContent).not.toMatch(/^Under current law/);
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.getByText("The effect of the policies is growth with them less growth under current law.")).toBeTruthy();
  });

  it("explains the two Show options behind an info icon, on hover, keyboard focus and a tap", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["threshold_freeze_2031_32"]} twinLink={null} />);
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Options:/ }));
    const info = screen.getByRole("button", { name: "What the Show options mean" });
    const effect = /^Effect \(pp\): How much the selected policies change each group's real income growth, in percentage points\.$/;
    const growth = /^Growth with the policies \(%\): Each group's real income growth with the selected policies in place: the current-law forecast plus the policies' effect\.$/;
    const lines = () => [...screen.getByRole("tooltip").querySelectorAll(".control-bar-tip-line")].map((n) => n.textContent);
    // Hover
    fireEvent.mouseEnter(info);
    expect(lines()[0]).toMatch(effect);
    expect(lines()[1]).toMatch(growth);
    expect(info.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(info);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Keyboard focus
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(info);
    expect(lines()).toHaveLength(2);
    fireEvent.blur(info);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // A tap on a touch screen toggles it
    fireEvent.pointerDown(info, { pointerType: "touch" });
    expect(lines()[1]).toMatch(growth);
    fireEvent.pointerDown(info, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("says so, with no chart, when the measure does not move HBAI income", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={["road_fuel_vat_cut"]} twinLink={null} />);
    expect(await screen.findByText(/do not change this income/)).toBeTruthy();
    expect(screen.queryByText(/Effect \(pp\)/)).toBeNull();
  });

  it("several policies: the published combined run of exactly them, with no package note", async () => {
    // The file's combined rows under the manifest's key, as generate
    // --only income_growth --published-package writes them
    GROWTH = FILE.replaceAll("autumn_budget_2026_combined,", `${KEY},`);
    render(<GrowthWithMeasuresCard selectedPolicies={[...PAIR].reverse()} twinLink={null} />, { wrapper: withCatalogue });
    expect(await screen.findByText(WITH_MEASURES_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(screen.queryByText(/whole package/)).toBeNull();
    expect(screen.queryByText(notPublished)).toBeNull();
  });

  it("several policies with no combined run of exactly them: the not-published notice, never the whole package", async () => {
    // The file holds the pair's run, but the selection is three policies
    GROWTH = FILE.replaceAll("autumn_budget_2026_combined,", `${KEY},`);
    render(<GrowthWithMeasuresCard selectedPolicies={[...PAIR, "road_fuel_vat_cut"]} twinLink={null} />, { wrapper: withCatalogue });
    expect(await screen.findByText(notPublished)).toBeTruthy();
    expect(screen.queryByText(/Effect \(pp\)/)).toBeNull();
    expect(screen.queryByText(/whole package/)).toBeNull();
  });

  it("refuses another package's rows: the registry's nine-measure run is not the selection's run (issue 228)", async () => {
    // The file as committed: its package rows are autumn_budget_2026_combined
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />, { wrapper: withCatalogue });
    expect(await screen.findByText(notPublished)).toBeTruthy();
    expect(screen.queryByText(/Effect \(pp\)/)).toBeNull();
  });

  it("gives the same notice when no manifest is loaded", async () => {
    render(<GrowthWithMeasuresCard selectedPolicies={PAIR} twinLink={null} />);
    expect(await screen.findByText(notPublished)).toBeTruthy();
  });
});
