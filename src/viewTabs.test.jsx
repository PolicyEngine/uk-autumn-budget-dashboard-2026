import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { POLICIES_INACTIVE, VIEWS, YEAR_INACTIVE, oldOutlookBaseline, opensYoungPeople, viewFromLocation } from "./App";
import { BASE_PATH, fixtureFetch, fixtureJson } from "./test/publicationFixture";

beforeEach(() => {
  const original = fixtureJson("manifest.json");
  const manifest = { ...original, measures: { alpha: original.measures.alpha }, combined: {} };
  const serve = fixtureFetch({ overrides: { "manifest.json": JSON.stringify(manifest) } });
  vi.stubGlobal("fetch", (url, init) => serve(`${BASE_PATH}${url}`, init));
  // The bare address is the landing page, with no tab bar (landing.test.jsx)
  window.history.replaceState({}, "", "/?tab=dashboard");
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
// A pill is always in the band (never hidden or inert); "shown" is whether
// it applies to the view: not faded, its button not aria-disabled
const visible = (pill) => !pill.classList.contains("is-hidden") && !pill.hasAttribute("inert") && !pill.hasAttribute("aria-hidden");
const shown = (pill) => visible(pill) && !pill.classList.contains("is-inactive") && !pill.querySelector('.band-control[aria-disabled="true"]');

describe("the view tabs", () => {
  it("are five tabs under the band, in order, with no view pill in the band", async () => {
    // The bare address is the landing page (landing.test.jsx)
    window.history.replaceState({}, "", "/?tab=dashboard");
    const { container } = await renderApp();
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "Population impact",
      "Household impact",
      "Pre-measures forecast",
      "Policies",
      "Methodology",
    ]);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveAttribute("tabindex", "0");
    expect(tabs()[1]).toHaveAttribute("tabindex", "-1");
    expect(band(container).querySelector(".band-view")).toBeNull();
    expect(screen.queryByRole("button", { name: /^View:/ })).toBeNull();
    // The intro is on the landing page only, never over a view
    expect(container.querySelector(".dashboard-intro")).toBeNull();
    expect(container.querySelector(".landing")).toBeNull();
    expect(container).not.toHaveTextContent("This dashboard uses");
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
      outlook: [false, false],
      policies: [false, false],
      methodology: [false, false],
    };
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      const year = band(container).querySelector(".band-year");
      const policy = band(container).querySelector(".band-policy");
      // Both stay in the band, visible, so the band never moves; one that
      // does not apply is faded and says why
      expect([visible(year), visible(policy)]).toEqual([true, true]);
      expect([shown(year), shown(policy)]).toEqual(expected[view.value]);
      expect(container.querySelector(".app")).not.toHaveAttribute("data-band");
      if (!expected[view.value][0]) {
        expect(year.querySelector(".band-control")).toHaveAttribute("aria-label", expect.stringContaining(YEAR_INACTIVE));
        fireEvent.click(year.querySelector(".band-control"));
        expect(year.querySelector('[role="listbox"]')).toBeNull();
        // No visible tip: the reason is in the name only
        fireEvent.mouseEnter(year.querySelector(".band-control"));
        fireEvent.pointerEnter(year.querySelector(".band-control"));
        fireEvent.focus(year.querySelector(".band-control"));
        fireEvent.mouseOver(year.querySelector(".band-control"));
        fireEvent.focusIn(year.querySelector(".band-control"));
        expect(document.querySelector(".tip")).toBeNull();
      }
      if (!expected[view.value][1]) {
        expect(policy.querySelector(".band-control")).toHaveAttribute("aria-label", `Select policies: ${POLICIES_INACTIVE}`);
        fireEvent.click(policy.querySelector(".band-control"));
        expect(policy.querySelector(".policy-selector-dropdown")).toBeNull();
        fireEvent.mouseEnter(policy.querySelector(".band-control"));
        fireEvent.pointerEnter(policy.querySelector(".band-control"));
        fireEvent.focus(policy.querySelector(".band-control"));
        fireEvent.mouseOver(policy.querySelector(".band-control"));
        fireEvent.focusIn(policy.querySelector(".band-control"));
        expect(document.querySelector(".tip")).toBeNull();
      }
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
    const tabParam = { dashboard: "dashboard", household: "household", outlook: "outlook", policies: "policies", methodology: "methodology" };
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
      ["/?tab=outlook", "Pre-measures forecast"],
      // An old link: Pre-measures forecast was Living standards
      ["/?tab=living", "Pre-measures forecast"],
      // Its old Baseline outlook sub-tab: now its Living standards
      ["/?tab=outlook&sub=baseline", "Pre-measures forecast"],
      ["/?tab=living&sub=baseline", "Pre-measures forecast"],
      ["/?tab=policies", "Policies"],
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
    expect(viewFromLocation({ search: "?tab=outlook&sub=baseline", hash: "" })).toBe("outlook");
    expect(oldOutlookBaseline({ search: "?tab=living&sub=baseline" })).toBe(true);
    expect(oldOutlookBaseline({ search: "?tab=outlook&sub=forecast" })).toBe(false);
    expect(oldOutlookBaseline({ search: "?sub=baseline" })).toBe(false);
    expect(opensYoungPeople({ search: "?tab=young", hash: "" })).toBe(true);
    expect(opensYoungPeople({ search: "?tab=living", hash: "" })).toBe(false);
  });

  it("describe every published measure on Policies, whatever the selection", async () => {
    window.history.replaceState({}, "", "/?sub=all&policies=alpha");
    await renderApp();
    // Population impact neither repeats the cards nor points to them
    expect(screen.queryByText("About selected policies")).toBeNull();
    expect(screen.queryByText(/What each measure does is on/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Policies" }));
    const panel = screen.getByRole("tabpanel", { name: "Policies" });
    // The fixture publishes one measure (beforeEach)
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("policies");
  });

  it("open Population impact with only one measure from its card's \"See its effect\"", async () => {
    window.history.replaceState({}, "", "/?tab=policies");
    await renderApp();
    const panel = screen.getByRole("tabpanel", { name: "Policies" });
    fireEvent.click(within(panel).getByRole("button", { name: /effect of Alpha/ }));
    expect(screen.getByRole("tab", { name: "Population impact" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("dashboard");
    expect(params.get("policies")).toBe("alpha");
  });

  it("move with the arrow keys, Home and End", async () => {
    window.history.replaceState({}, "", "/?tab=dashboard");
    await renderApp();
    const list = viewList();
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tabs()[4]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tabpanel", { name: "Methodology" })).toBeInTheDocument();
  });

  it("open a sub-tab band only on views with sub-tabs, and keep the view tabs a keyboard tablist", async () => {
    window.history.replaceState({}, "", "/?tab=dashboard");
    await renderApp();
    const bar = document.querySelector(".view-tabs-bar");
    expect(bar).toHaveClass("has-notch");
    // One sliding indicator, hidden from assistive tech, outside the tabs
    const indicator = bar.querySelectorAll(".view-tabs-indicator");
    expect(indicator).toHaveLength(1);
    expect(indicator[0]).toHaveAttribute("aria-hidden", "true");
    expect(tabs()).toHaveLength(VIEWS.length);
    for (const name of ["Policies", "Methodology"]) {
      fireEvent.click(within(viewList()).getByRole("tab", { name }));
      const panel = screen.getByRole("tabpanel", { name });
      expect(panel.querySelector(".sub-tabs-band")).toBeNull();
      expect(bar).not.toHaveClass("has-notch");
    }
    // Roving tabindex: only the chosen view tab is in the Tab order
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(viewList(), { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveFocus();
    expect(bar).toHaveClass("has-notch");
  });

  it("split Population impact into six sub-tabs, Public finances first", async () => {
    window.history.replaceState({}, "", "/?tab=dashboard");
    await renderApp();
    const panel = screen.getByRole("tabpanel", { name: "Population impact" });
    // The band sits directly under the view tabs, first in the view's
    // panel (after its zero-height sentinel), and holds the sub-tabs
    expect(panel.firstElementChild).toHaveClass("sub-tabs-sentinel");
    expect(panel.firstElementChild.nextElementSibling).toHaveClass("sub-tabs-band");
    expect(panel.firstElementChild.nextElementSibling).toContainElement(subList());
    // The chosen view's tab opens into it
    expect(document.querySelector(".view-tabs-bar")).toHaveClass("has-notch");
    expect(subTabs().map((tab) => tab.textContent)).toEqual([
      "Public finances",
      "All households",
      "Young people",
      "Pensioners",
      "Living standards",
      "Poverty",
    ]);
    expect(subTabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Change by age" })).toBeNull();
    // The default sub-tab has no ?sub=
    expect(window.location.search).not.toContain("sub=");

    fireEvent.click(subTabs()[2]);
    expect(subTabs()[2]).toHaveAttribute("aria-selected", "true");
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
    expect(subTabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
  });

  it("open the Pensioners sub-tab from ?sub=pensioners, and write it on choosing it", async () => {
    window.history.replaceState({}, "", "/?sub=pensioners");
    const { unmount } = await renderApp();
    expect(screen.getByRole("tab", { name: "Pensioners" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tabpanel", { name: "Pensioners" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("pensioners");
    unmount();

    window.history.replaceState({}, "", "/?tab=dashboard");
    await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Pensioners" }));
    expect(screen.getByRole("tab", { name: "Pensioners" })).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("pensioners");
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
        "dashboard",
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
    // Back to Public finances, the default: the hash goes with the sub-tab
    fireEvent.click(screen.getByRole("tab", { name: "Public finances" }));
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
      "Pre-measures forecast",
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
    expect(within(living).getByRole("link", { name: "Forecast changes" })).toHaveAttribute("href", "?tab=outlook&sub=forecast");
    // Said once on the page
    for (const phrase of [
      /dominance and p% rules/g,
      /leave out interactions between measures/g,
    ]) {
      expect(container.textContent.match(phrase)).toHaveLength(1);
    }
  });
});
