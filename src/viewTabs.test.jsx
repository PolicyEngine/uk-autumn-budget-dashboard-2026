import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { VIEWS, opensYoungPeople, viewFromLocation } from "./App";
import { BASE_PATH, fixtureFetch, fixtureJson } from "./test/publicationFixture";

beforeEach(() => {
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

const viewList = () => screen.getByRole("tablist", { name: "Views" });
const tabs = () => within(viewList()).getAllByRole("tab");
const subList = () => screen.getByRole("tablist", { name: "Population impact sections" });
const subTabs = () => within(subList()).getAllByRole("tab");
const band = (container) => container.querySelector(".title-row");
const shown = (pill) => !pill.classList.contains("is-hidden") && !pill.hasAttribute("inert");

describe("the view tabs", () => {
  it("are four tabs under the intro, in order, with no view pill in the band", async () => {
    const { container } = await renderApp();
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "Population impact",
      "Household impact",
      "Living standards",
      "Methodology",
    ]);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveAttribute("tabindex", "0");
    expect(tabs()[1]).toHaveAttribute("tabindex", "-1");
    expect(band(container).querySelector(".band-view")).toBeNull();
    expect(screen.queryByRole("button", { name: /^View:/ })).toBeNull();
    // The intro holds for every view, and sits above the tabs
    const intro = container.querySelector(".dashboard-intro");
    expect(intro).toHaveTextContent(
      /^This dashboard uses PolicyEngine UK to show how Autumn Budget 2026 measures would affect the public finances and households: by income, area and age, and for your own household, alongside the living standards outlook\. Measures and costings: .+; forecast: .+\. Choose a year and policies in the bar above\.$/,
    );
    expect(intro.compareDocumentPosition(viewList())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("tabpanel", { name: "Population impact" })).toBeInTheDocument();
  });

  it("shows no candidate banner on any view", async () => {
    const { container } = await renderApp();
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      expect(container.querySelector(".candidate-banner")).toBeNull();
      expect(screen.queryByText(/not announced policy/)).toBeNull();
    });
  });

  it("show the year and policy pills only where they apply", async () => {
    const { container } = await renderApp();
    const expected = {
      dashboard: [true, true],
      // The year drives Household impact's household calculation
      household: [true, true],
      living: [false, false],
      methodology: [false, false],
    };
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      const year = band(container).querySelector(".band-year");
      const policy = band(container).querySelector(".band-policy");
      // Both stay in the band, so a hidden one keeps its place
      expect([shown(year), shown(policy)]).toEqual(expected[view.value]);
    });
  });

  it("show the year pill on Household impact, whatever an old ?sub= link says", async () => {
    window.history.replaceState({}, "", "/?tab=personal&sub=multi");
    const { container } = await renderApp();
    expect(shown(band(container).querySelector(".band-year"))).toBe(true);
    expect(container.querySelector(".app")).not.toHaveAttribute("data-band");
  });

  it("keep ?tab= in step, the default selection out of the address and a chosen one on every view", async () => {
    // Review of 15439f4, finding 2: the default follows the publication,
    // and a chosen selection survives a view without the policy pill
    const search = () => new URLSearchParams(window.location.search);
    const tabParam = { dashboard: null, household: "household", living: "living", methodology: "methodology" };
    const { unmount } = await renderApp();
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      expect([search().get("tab"), search().get("policies")]).toEqual([tabParam[view.value], null]);
    });
    unmount();
    window.history.replaceState({}, "", "/?policies=alpha");
    await renderApp();
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      expect([search().get("tab"), search().get("policies")]).toEqual([tabParam[view.value], "alpha"]);
    });
  });

  it("open the view an old or new link names", async () => {
    for (const [url, label] of [
      ["/?tab=household", "Household impact"],
      // An old link: the view it named, at its new address
      ["/?tab=personal", "Household impact"],
      ["/?tab=living", "Living standards"],
      ["/?tab=dashboard", "Population impact"],
      ["/?tab=methodology", "Methodology"],
      ["/?tab=nonsense", "Population impact"],
    ]) {
      window.history.replaceState({}, "", url);
      const { unmount } = await renderApp();
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
    expect(viewFromLocation({ search: "?tab=personal", hash: "" })).toBe("household");
    expect(viewFromLocation({ search: "?tab=living", hash: "#young-people" })).toBe("dashboard");
    expect(viewFromLocation({ search: "?tab=young", hash: "" })).toBe("dashboard");
    expect(opensYoungPeople({ search: "?tab=young", hash: "" })).toBe(true);
    expect(opensYoungPeople({ search: "?tab=living", hash: "" })).toBe(false);
  });

  it("move with the arrow keys, Home and End", async () => {
    await renderApp();
    const list = viewList();
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tabs()[3]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tabpanel", { name: "Methodology" })).toBeInTheDocument();
  });

  it("split Population impact into All households and Young people sub-tabs", async () => {
    await renderApp();
    const panel = screen.getByRole("tabpanel", { name: "Population impact" });
    // The pill sits directly under the view tabs, inside the view's panel
    expect(panel.firstElementChild).toBe(subList());
    expect(subTabs().map((tab) => tab.textContent)).toEqual(["All households", "Young people"]);
    expect(subTabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Change by age" })).toBeNull();
    // The default sub-tab has no ?sub=
    expect(window.location.search).not.toContain("sub=");

    fireEvent.click(subTabs()[1]);
    expect(subTabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tabpanel", { name: "Young people" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
    // The year and policy pills drive both sub-tabs
    expect(shown(band(document.body).querySelector(".band-year"))).toBe(true);
    expect(shown(band(document.body).querySelector(".band-policy"))).toBe(true);
    // The default selection stays out of the address
    expect(new URLSearchParams(window.location.search).has("policies")).toBe(false);

    // Another view drops ?sub=; the view stays mounted, so coming back
    // shows the sub-tab left open, and its ?sub= again
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(window.location.search).not.toContain("sub=");
    fireEvent.click(screen.getByRole("tab", { name: "Population impact" }));
    expect(subTabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
  });

  it("open the Young people sub-tab from the old links, keeping the hash", async () => {
    for (const [url, hash] of [
      ["/?tab=young", ""],
      ["/#young-people", "#young-people"],
      ["/?sub=young", ""],
    ]) {
      window.history.replaceState({}, "", url);
      const { unmount } = await renderApp();
      expect(screen.getByRole("tab", { name: "Population impact" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", { name: "Young people" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const params = new URLSearchParams(window.location.search);
      expect([params.get("tab"), params.get("sub"), window.location.hash]).toEqual([
        null,
        "young",
        hash,
      ]);
      unmount();
    }
  });

  it("open Young people from a #young-people link on another view, and drop the hash on leaving", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    await renderApp();
    window.history.replaceState({}, "", "/?tab=methodology#young-people");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByRole("tab", { name: "Population impact" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Young people" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Back to All households: the hash goes with the sub-tab
    fireEvent.click(screen.getByRole("tab", { name: "All households" }));
    expect(window.location.hash).toBe("");
    expect(window.location.search).not.toContain("sub=");
  });

  it("open Young people from Methodology's link", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    await renderApp();
    fireEvent.click(screen.getByRole("link", { name: "Young people results" }));
    expect(screen.getByRole("tab", { name: "Young people" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
  });

  it("gather the method notes on Methodology, each said once", async () => {
    const { container } = await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    const panel = screen.getByRole("tabpanel", { name: "Methodology" });
    for (const name of [
      "At a glance",
      "Data",
      "Model and measures",
      "Population impact",
      "Figures by area",
      "Young people",
      "Household impact",
      "Living standards",
      "Limitations",
    ]) {
      expect(within(panel).getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(within(panel).getByRole("heading", { level: 3, name: "Household calculation" })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/lifetime/i);
    expect(panel).toHaveTextContent("dominance and p% rules");
    // No leftover link to last year's research
    expect(panel).not.toHaveTextContent("our research on the");
    expect(panel.querySelector('a[href*="policyengine.org/uk/research"]')).toBeNull();
    const living = panel.querySelector("#method-living");
    expect(within(living).getByRole("link", { name: "Living standards" })).toBeInTheDocument();
    // Said once on the page
    for (const phrase of [
      /dominance and p% rules/g,
      /leave out interactions between measures/g,
    ]) {
      expect(container.textContent.match(phrase)).toHaveLength(1);
    }
  });
});
