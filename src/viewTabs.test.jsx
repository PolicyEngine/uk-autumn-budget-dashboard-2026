import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App, { VIEWS, opensYoungPeople, viewFromLocation } from "./App";

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

const viewList = () => screen.getByRole("tablist", { name: "Views" });
const tabs = () => within(viewList()).getAllByRole("tab");
const subList = () => screen.getByRole("tablist", { name: "Population impact sections" });
const subTabs = () => within(subList()).getAllByRole("tab");
const band = (container) => container.querySelector(".title-row");
const shown = (pill) => !pill.classList.contains("is-hidden") && !pill.hasAttribute("inert");

describe("the view tabs", () => {
  it("are four tabs under the intro, in order, with no view pill in the band", () => {
    const { container } = render(<App />);
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "Population impact",
      "Personal impact",
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
    expect(intro.compareDocumentPosition(viewList())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("tabpanel", { name: "Population impact" })).toBeInTheDocument();
  });

  it("show the year and policy pills only where they apply", () => {
    const { container } = render(<App />);
    const expected = {
      dashboard: [true, true],
      // The year drives Personal impact's household calculation
      personal: [true, true],
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

  it("show the year pill on Personal impact, whatever an old ?sub= link says", () => {
    window.history.replaceState({}, "", "/?tab=personal&sub=multi");
    const { container } = render(<App />);
    expect(shown(band(container).querySelector(".band-year"))).toBe(true);
    expect(container.querySelector(".app")).not.toHaveAttribute("data-band");
  });

  it("keep ?tab= in step, with the policies only on the views they drive", () => {
    render(<App />);
    const search = () => new URLSearchParams(window.location.search);
    const expected = {
      dashboard: [null, true],
      personal: ["personal", false],
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
      ["/?tab=methodology", "Methodology"],
      ["/?tab=nonsense", "Population impact"],
    ]) {
      window.history.replaceState({}, "", url);
      const { unmount } = render(<App />);
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
      unmount();
    }
    expect(viewFromLocation({ search: "?tab=living", hash: "#young-people" })).toBe("dashboard");
    expect(viewFromLocation({ search: "?tab=young", hash: "" })).toBe("dashboard");
    expect(opensYoungPeople({ search: "?tab=young", hash: "" })).toBe(true);
    expect(opensYoungPeople({ search: "?tab=living", hash: "" })).toBe(false);
  });

  it("move with the arrow keys, Home and End", () => {
    render(<App />);
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
    render(<App />);
    const panel = screen.getByRole("tabpanel", { name: "Population impact" });
    // The pill sits directly under the view tabs, inside the view's panel
    expect(panel.firstElementChild).toBe(subList());
    expect(subTabs().map((tab) => tab.textContent)).toEqual(["All households", "Young people"]);
    expect(subTabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Young people (under 25)" })).toBeNull();
    // The default sub-tab has no ?sub=
    expect(window.location.search).not.toContain("sub=");

    fireEvent.click(subTabs()[1]);
    expect(subTabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("heading", { name: "Young people (under 25)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Young people" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
    // The year and policy pills drive both sub-tabs
    expect(shown(band(document.body).querySelector(".band-year"))).toBe(true);
    expect(shown(band(document.body).querySelector(".band-policy"))).toBe(true);
    expect(new URLSearchParams(window.location.search).has("policies")).toBe(true);

    // Another view drops ?sub=; coming back opens All households
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(window.location.search).not.toContain("sub=");
    fireEvent.click(screen.getByRole("tab", { name: "Population impact" }));
    expect(subTabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("open the Young people sub-tab from the old links, keeping the hash", () => {
    for (const [url, hash] of [
      ["/?tab=young", ""],
      ["/#young-people", "#young-people"],
      ["/?sub=young", ""],
    ]) {
      window.history.replaceState({}, "", url);
      const { unmount } = render(<App />);
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

  it("open Young people from a #young-people link on another view, and drop the hash on leaving", () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    render(<App />);
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

  it("open Young people from Methodology's link", () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "See Young people under Population impact" }));
    expect(screen.getByRole("tab", { name: "Young people" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("young");
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
    expect(within(panel).getByRole("heading", { level: 3, name: "Household calculation" })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/lifetime/i);
    expect(panel).toHaveTextContent("dominance and p% rules");
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
