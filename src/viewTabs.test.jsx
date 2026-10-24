import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App, { VIEWS, viewFromLocation } from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(dashboardFixtureFetch()));
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderApp() {
  const rendered = render(<App />);
  // The first render verifies the whole fixture (Web Crypto); allow for a busy host
  await screen.findByRole("tablist", { name: "Views" }, { timeout: 15000 });
  return rendered;
}

const tabs = () => within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
const band = (container) => container.querySelector(".title-row");
const shown = (pill) => !pill.classList.contains("is-hidden") && !pill.hasAttribute("inert");

describe("the view tabs", async () => {
  it("are five tabs under the intro, in order, with no view pill in the band", async () => {
    const { container } = await renderApp();
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "Population impact",
      "Personal impact",
      "Young people",
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
      "How the Autumn Budget 2026 measures affect the public finances, households across the income distribution, regions and constituencies, example households and individuals, and young people, with the living standards baseline. Choose a year and policies in the bar above.",
    );
    expect(intro.compareDocumentPosition(screen.getByRole("tablist"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("tabpanel", { name: "Population impact" })).toBeInTheDocument();
  });

  it("show the year and policy pills only where they apply", async () => {
    const { container } = await renderApp();
    const expected = {
      dashboard: [true, true],
      personal: [false, true],
      young: [true, true],
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

  it("keep ?tab= in step, with the policies only on the views they drive", async () => {
    await renderApp();
    const search = () => new URLSearchParams(window.location.search);
    const expected = {
      dashboard: [null, true],
      personal: ["personal", false],
      young: ["young", true],
      living: ["living", false],
      methodology: ["methodology", false],
    };
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      expect([search().get("tab"), search().has("policies")]).toEqual(expected[view.value]);
    });
  });

  it("open the view an old or new link names", async () => {
    for (const [url, label] of [
      ["/?tab=personal", "Personal impact"],
      ["/?tab=living", "Living standards"],
      ["/?tab=dashboard", "Population impact"],
      ["/?tab=young", "Young people"],
      ["/?tab=methodology", "Methodology"],
      ["/?tab=nonsense", "Population impact"],
      ["/#young-people", "Young people"],
    ]) {
      window.history.replaceState({}, "", url);
      const { unmount } = await renderApp();
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
    expect(viewFromLocation({ search: "?tab=living", hash: "#young-people" })).toBe("young");
  });

  it("move with the arrow keys, Home and End", async () => {
    await renderApp();
    const list = screen.getByRole("tablist");
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

  it("give Young people its own view, out of Population impact", async () => {
    await renderApp();
    expect(screen.queryByRole("heading", { name: "Young people (under 25)" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Young people" }));
    expect(
      await screen.findByRole("heading", { name: "Young people (under 25)" }),
    ).toBeInTheDocument();
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
      "Personal impact",
      "Living standards",
      "Limitations",
      "Versions and replication",
    ]) {
      expect(within(panel).getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(within(panel).getByRole("heading", { level: 3, name: "Lifetime model" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("dominance and p% rules");
    expect(panel).toHaveTextContent("Earnings follow an age profile that starts at 22");
    expect(panel).toHaveTextContent("Methods and sources are published with each measure's description.");
    const living = panel.querySelector("#method-living");
    expect(within(living).getByRole("link", { name: "Living standards" })).toBeInTheDocument();
    // Said once on the page
    for (const phrase of [
      /Methods and sources/g,
      /dominance and p% rules/g,
      /interactions between measures are not included/g,
      /line at the foot of the page/g,
    ]) {
      expect(container.textContent.match(phrase)).toHaveLength(1);
    }
  });
});
