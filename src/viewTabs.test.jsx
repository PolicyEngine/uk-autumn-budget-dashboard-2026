import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App, { CANDIDATE_BANNER, VIEWS, viewFromLocation } from "./App";

beforeEach(() => {
  // An empty CSV for every data file: these tests are about the views
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("reform_id,year,value\n", { status: 200 })),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tabs = () => within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
const band = (container) => container.querySelector(".title-row");
const shown = (pill) => !pill.classList.contains("is-hidden") && !pill.hasAttribute("inert");

describe("the view tabs", () => {
  it("are five tabs under the intro, in order, with no view pill in the band", () => {
    const { container } = render(<App />);
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
      "How ten candidate Autumn Budget 2026 measures would affect the public finances, households across the income distribution, regions and constituencies, example households and individuals, and young people, with the living standards baseline. Choose a year and policies in the bar above.",
    );
    expect(intro.compareDocumentPosition(screen.getByRole("tablist"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("tabpanel", { name: "Population impact" })).toBeInTheDocument();
  });

  it("say once, under the intro, that the measures are candidates, except on Living standards and Methodology", () => {
    const { container } = render(<App />);
    const withBanner = { dashboard: true, personal: true, young: true, living: false, methodology: false };
    VIEWS.forEach((view, index) => {
      fireEvent.click(tabs()[index]);
      const banners = screen.queryAllByText(CANDIDATE_BANNER);
      expect(banners).toHaveLength(withBanner[view.value] ? 1 : 0);
      if (banners.length) {
        // Directly under the intro, above the tabs
        const banner = container.querySelector(".candidate-banner");
        expect(banner.previousElementSibling).toBe(container.querySelector(".dashboard-intro"));
      }
    });
    expect(CANDIDATE_BANNER).toBe(
      "Candidate measures, modelled before the Budget on 28 October; not announced policy.",
    );
  });

  it("show the year and policy pills only where they apply", () => {
    const { container } = render(<App />);
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

  it("keep ?tab= in step, with the policies only on the views they drive", () => {
    render(<App />);
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

  it("open the view an old or new link names", () => {
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
      const { unmount } = render(<App />);
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
    expect(viewFromLocation({ search: "?tab=living", hash: "#young-people" })).toBe("young");
  });

  it("move with the arrow keys, Home and End", () => {
    render(<App />);
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
    render(<App />);
    expect(screen.queryByRole("heading", { name: "Young people (under 25)" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Young people" }));
    expect(
      await screen.findByRole("heading", { name: "Young people (under 25)" }),
    ).toBeInTheDocument();
  });

  it("gather the method notes on Methodology, each said once", () => {
    const { container } = render(<App />);
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
    expect(panel).toHaveTextContent("Methods and sources: our research on the");
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
