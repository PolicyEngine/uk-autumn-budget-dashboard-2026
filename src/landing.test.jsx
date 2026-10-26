import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { DECILES_ANCHOR } from "./App";
import { YOUNG_PEOPLE_ANCHOR } from "./components/YoungPeopleSection";
import { resetPresetResults } from "./utils/householdPresets";
import { DEEP_LINK_HASHES, DEEP_LINK_SCRIPT, opensLanding } from "./utils/landing";
import { provisionalLabel } from "./utils/publication/manifest";
import { BASE_PATH, fixtureFetch, fixtureJson } from "./test/publicationFixture";

const INTRO =
  /^Estimates from PolicyEngine UK of how Autumn Budget 2026 measures affect the public finances and household incomes across the income distribution, regions and age groups, set against the pre-measures forecast\. Costings are our own; the economic forecast is the OBR’s Economic and fiscal outlook, March 2026\.$/;

const BOXES = {
  society: /^The Budget and society/,
  household: /^Your household/,
  policies: /^What's in the Budget/,
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
  await waitFor(() => expect(rendered.container.querySelector('.app[data-publication="verified"]')).not.toBeNull());
  return rendered;
}

const landing = () => screen.queryByRole("region", { name: "Autumn Budget 2026: fiscal and distributional analysis" });
const box = (name) => screen.getByRole("link", { name: BOXES[name] });
const tabBar = () => screen.queryByRole("tablist", { name: "Views" });
const viewTab = (name) => within(tabBar()).getByRole("tab", { name });
const selectedViewTabs = () =>
  within(tabBar())
    .getAllByRole("tab")
    .filter((tab) => tab.getAttribute("aria-selected") === "true");
const home = () => screen.getByRole("button", { name: "Back to the start: about this dashboard" });
const search = () => new URLSearchParams(window.location.search);

describe("the landing page", () => {
  it("shows at the bare address: a heading and paragraph, then three boxes, under the band, with no tab bar", async () => {
    const { container } = await renderApp();
    const page = landing();
    expect(page).not.toBeNull();
    expect(within(page).getByText("PolicyEngine UK", { selector: ".landing-eyebrow" })).toBeInTheDocument();
    expect(within(page).getByRole("heading", { level: 2 })).toHaveTextContent("Autumn Budget 2026: fiscal and distributional analysis");
    expect(within(page).getByText(/^Estimates from/)).toHaveTextContent(INTRO);
    expect(container).not.toHaveTextContent("Choose a year and policies");
    // Each box: a title, one short line and "Explore", and no figure
    expect(within(page).getAllByRole("link", { name: /Explore$/ }).map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      ["?tab=dashboard&sub=finances", "The Budget and societyPublic finances, and who gains and losesExplore→"],
      ["?tab=household", "Your householdSee how your income changesExplore→"],
      ["?tab=policies", "What's in the BudgetEvery measure, and how we model itExplore→"],
    ]);
    expect(page.querySelector(".landing-box-figure")).toBeNull();
    expect(page.querySelector(".landing-boxes")).not.toHaveTextContent(/£|\d/);
    // No tab bar: the boxes are the navigation, reached by the keyboard
    // straight after the band and the paragraph's two links
    expect(tabBar()).toBeNull();
    expect(container.querySelector(".view-tabs-bar")).toHaveAttribute("hidden");
    expect(container.querySelector(".app")).not.toHaveAttribute("data-sub-band");
    const tabbable = [...container.querySelectorAll(".main-content a[href], .main-content button, .main-content [tabindex]")]
      .filter((node) => !node.closest(".title-row, [hidden], [inert]") && node.tabIndex >= 0);
    expect(tabbable.slice(0, 5).map((node) => node.textContent)).toEqual([
      "PolicyEngine UK",
      "Economic and fiscal outlook, March 2026",
      expect.stringMatching(BOXES.society),
      expect.stringMatching(BOXES.household),
      expect.stringMatching(BOXES.policies),
    ]);
    // The band keeps both pills
    const band = container.querySelector(".title-row");
    for (const pill of [".band-year", ".band-policy"]) {
      expect(band.querySelector(pill)).not.toHaveClass("is-hidden");
      expect(band.querySelector(pill)).not.toHaveAttribute("inert");
    }
    expect(window.location.search).toBe("");
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
    // Once, under the paragraph, in the manifest's own wording
    expect(notes()).toHaveLength(1);
    expect(landing().querySelector(".publication-provisional")).toHaveTextContent(provisionalLabel(manifest));
    fireEvent.click(box("policies"));
    // Not over any view (the overview drawer has it only while open)
    expect(notes()).toHaveLength(0);
  });

  it("draws a silhouette of Public finances behind it, with no view mounted", async () => {
    const { container } = await renderApp();
    const backdrop = container.querySelector(".landing-backdrop");
    expect(container.querySelector(".view-stage")).toHaveClass("is-landing");
    // Decoration only: hidden from assistive tech, nothing in it to reach
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop.querySelectorAll("rect").length).toBeGreaterThan(10);
    expect(backdrop.querySelector("a, button, [tabindex]")).toBeNull();
    // No view is mounted yet, so the page settles without them
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
    fireEvent.click(box("society"));
    expect(container.querySelector(".landing-backdrop")).toBeNull();
    expect(container.querySelector(".view-stage")).not.toHaveClass("is-landing");
    expect(screen.getByRole("tabpanel", { name: "Population impact" })).toBeInTheDocument();
  });

  it("opens Population impact at Public finances from the first box, and brings the tab bar", async () => {
    const { container } = await renderApp();
    fireEvent.click(box("society"));
    expect(landing()).toBeNull();
    expect(container.querySelector(".view-tabs-bar")).not.toHaveAttribute("hidden");
    expect(selectedViewTabs().map((tab) => tab.textContent)).toEqual(["Population impact"]);
    expect(screen.getByRole("tab", { name: "Public finances" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Public finances" })).toBeInTheDocument();
    // Public finances is the default sub-tab, so ?sub= is left out
    expect([search().get("tab"), search().get("sub")]).toEqual(["dashboard", null]);
  });

  it("opens Household impact from the second box", async () => {
    await renderApp();
    fireEvent.click(box("household"));
    expect(landing()).toBeNull();
    expect(selectedViewTabs().map((tab) => tab.textContent)).toEqual(["Household impact"]);
    expect(screen.getByRole("tabpanel", { name: "Household impact" })).toBeInTheDocument();
    expect([search().get("tab"), search().get("sub")]).toEqual(["household", null]);
  });

  it("opens Policies from the third box, and any view from the tab bar after", async () => {
    await renderApp();
    fireEvent.click(box("policies"));
    expect(landing()).toBeNull();
    expect(selectedViewTabs().map((tab) => tab.textContent)).toEqual(["Policies"]);
    expect(screen.getByRole("tabpanel", { name: "Policies" })).toBeInTheDocument();
    expect(search().get("tab")).toBe("policies");
    fireEvent.click(viewTab("Methodology"));
    expect(search().get("tab")).toBe("methodology");
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
    expect(container.querySelector(".view-tabs-bar")).not.toHaveAttribute("hidden");
    expect(container.querySelector(".view-panels")).not.toHaveAttribute("inert");
    expect(viewTab(view)).toHaveAttribute("aria-selected", "true");
  });
});

describe("the band's home button", () => {
  it("is marked current on the landing page, where it does nothing", async () => {
    await renderApp();
    expect(home()).toHaveAttribute("aria-current", "page");
    fireEvent.click(home());
    expect(landing()).not.toBeNull();
    expect(window.location.search).toBe("");
  });

  it("says what the dashboard is on hover or focus", async () => {
    await renderApp();
    fireEvent.focus(home());
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/^About this dashboard/);
    expect(home()).toHaveAttribute("aria-describedby", tip.id);
  });

  it("goes back to the landing page from any view, in place", async () => {
    window.history.replaceState({}, "", "/?tab=dashboard&sub=all&policies=alpha");
    const { container } = await renderApp();
    expect(home()).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("tab", { name: "All households" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(home());
    expect(landing()).not.toBeNull();
    expect(tabBar()).toBeNull();
    expect(home()).toHaveAttribute("aria-current", "page");
    // The bare address: a reload opens the landing page again
    expect(window.location.search).toBe("");
    // Behind it, the silhouette; the view is kept, hidden
    expect(container.querySelector(".landing-backdrop")).not.toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    // The selection is kept, and comes back to the address with a view
    fireEvent.click(box("household"));
    expect([search().get("tab"), search().get("policies")]).toEqual(["household", "alpha"]);
  });
});

describe("the About tab on the window's edge, and its overview drawer", () => {
  const edge = () => screen.queryByRole("button", { name: "About this dashboard: open the overview" });
  const drawer = () => screen.queryByRole("dialog", { name: "Autumn Budget 2026: fiscal and distributional analysis" });
  const openDrawer = async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    const rendered = await renderApp();
    fireEvent.click(edge());
    return rendered;
  };

  it("is not on the landing page", async () => {
    await renderApp();
    expect(landing()).not.toBeNull();
    expect(edge()).toBeNull();
    expect(drawer()).toBeNull();
  });

  it("says what the dashboard is on hover or focus", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    await renderApp();
    expect(edge()).toHaveTextContent("About");
    expect(edge()).toHaveAttribute("aria-expanded", "false");
    fireEvent.focus(edge());
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/^About this dashboard.*Click to open the overview\.$/);
  });

  it("opens a modal drawer with the overview, focus inside and the page locked", async () => {
    await openDrawer();
    const dialog = drawer();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(edge()).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText(/^Estimates from/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link", { name: /Explore$/ })).toHaveLength(3);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close the overview" })).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    // The view stays where it was
    expect(search().get("tab")).toBe("methodology");
  });

  it("closes by the close button, Esc, the backdrop or the tab, with focus back on the tab", async () => {
    const { container } = await openDrawer();
    fireEvent.click(within(drawer()).getByRole("button", { name: "Close the overview" }));
    expect(drawer()).toBeNull();
    expect(edge()).toHaveFocus();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(edge());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer()).toBeNull();

    fireEvent.click(edge());
    fireEvent.click(container.querySelector(".overview-backdrop"));
    expect(drawer()).toBeNull();

    fireEvent.click(edge());
    expect(drawer()).not.toBeNull();
    fireEvent.click(edge());
    expect(drawer()).toBeNull();
  });

  it("keeps Tab inside the drawer", async () => {
    await openDrawer();
    const dialog = drawer();
    const close = within(dialog).getByRole("button", { name: "Close the overview" });
    const links = within(dialog).getAllByRole("link");
    links.at(-1).focus();
    fireEvent.keyDown(links.at(-1), { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(links.at(-1)).toHaveFocus();
  });

  it.each([
    [/^The Budget and society/, "Population impact", "dashboard"],
    [/^Your household/, "Household impact", "household"],
    [/^What's in the Budget/, "Policies", "policies"],
  ])("opens a view from a box and closes: %s", async (name, view, tab) => {
    await openDrawer();
    fireEvent.click(within(drawer()).getByRole("link", { name }));
    expect(drawer()).toBeNull();
    expect(viewTab(view)).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe(tab);
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
});
