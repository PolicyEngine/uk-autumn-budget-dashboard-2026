import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ViewSkeleton, { BootSkeleton, SKELETON_SUB_TABS, SKELETON_VIEWS } from "./ViewSkeleton";
import { POPULATION_SUB_TABS } from "../PopulationImpactView";
import { OUTLOOK_SUB_TABS } from "../livingStandards/LivingStandardsTab";

describe("a view's loading placeholder", () => {
  it("draws the views' sub-tabs as their real rows do", () => {
    expect(SKELETON_SUB_TABS.dashboard).toEqual(POPULATION_SUB_TABS);
    expect(SKELETON_SUB_TABS.outlook).toEqual(OUTLOOK_SUB_TABS);
  });

  it("shows the view's heading, its sub-tab chosen and a loading caption, never a number", () => {
    const { container } = render(<ViewSkeleton view="dashboard:all" />);
    expect(screen.getByRole("heading", { name: "By area" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading results…");
    expect(container.querySelector('.sub-tab[aria-selected="true"]')).toHaveTextContent("All households");
    expect(container.textContent).not.toMatch(/£|\d/);
    expect(container.textContent).not.toMatch(/approved for publication/);
  });

  // Before any code runs the real row's --view-tab-x is unset, so the
  // placeholder's row starts under the chosen tab by itself: an unseen copy
  // of the tabs before the chosen one (publication.css). About is a side
  // tab on the window's edge, in neither row
  it("starts its sub-tab row under the chosen view tab, after an unseen copy of the tabs before it", () => {
    const viewTabs = [
      { value: "dashboard", label: "Population impact" },
      { value: "household", label: "Household calculator" },
      { value: "outlook", label: "Current law" },
      { value: "policies", label: "Policies" },
    ];
    const labels = (node) => [...node.querySelectorAll(".view-tab-label")].map((label) => label.textContent);
    const outlook = render(<ViewSkeleton view="outlook:living" viewTabs={viewTabs} />).container;
    const band = outlook.querySelector(".skeleton-sub-tabs");
    expect(band).toHaveClass("has-tab-lead");
    const lead = band.querySelector(".skeleton-tab-lead");
    expect(labels(lead)).toEqual(["Population impact", "Household calculator"]);
    // Then an unseen copy of the chosen tab, which the lead gives way to
    // where the bar scrolls; a tab follows it, so 24px of room after it
    const ghost = band.querySelector(".skeleton-tab-ghost");
    expect(lead.nextElementSibling).toBe(ghost);
    expect(ghost.nextElementSibling).toHaveClass("sub-tabs");
    expect(labels(ghost)).toEqual(["Current law"]);
    expect(ghost).not.toHaveClass("is-last");
    expect(outlook.querySelector(".edge-about")).toBeNull();
    expect(outlook.querySelector(".boot-view-tabs")).not.toHaveClass("has-leading");
    expect(band.closest('[aria-hidden="true"]')).toBe(band);
    // The first view: an empty lead, which takes no room (:empty)
    const dashboard = render(<ViewSkeleton view="dashboard:finances" viewTabs={viewTabs} />).container;
    expect(dashboard.querySelector(".skeleton-tab-lead").childNodes).toHaveLength(0);
    // With no copy of the bar (the real one is on the page), the row takes
    // the real bar's --view-tab-x as before
    const bare = render(<ViewSkeleton view="outlook:living" />).container;
    expect(bare.querySelector(".skeleton-tab-lead")).toBeNull();
    expect(bare.querySelector(".skeleton-tab-ghost")).toBeNull();
    expect(bare.querySelector(".skeleton-sub-tabs")).not.toHaveClass("has-tab-lead");
  });

  // A narrow bar scrolls to the chosen tab (ViewTabs.jsx, scrollToShow);
  // its copy is laid out to end where the real row will (publication.css)
  it("keeps the tabs after the chosen one in a tail of its copy of the bar, in order", () => {
    const viewTabs = [
      { value: "dashboard", label: "Population impact" },
      { value: "household", label: "Household calculator" },
      { value: "outlook", label: "Current law" },
      { value: "policies", label: "Policies" },
      { value: "methodology", label: "Methodology" },
    ];
    const labels = (node) => [...node.querySelectorAll(".view-tab-label")].map((label) => label.textContent);
    const row = render(<ViewSkeleton view="outlook:living" viewTabs={viewTabs} />).container.querySelector(".boot-view-tabs .view-tabs");
    expect(labels(row)).toEqual(viewTabs.map(({ label }) => label));
    const tail = row.querySelector(".skeleton-tab-tail");
    expect(labels(tail)).toEqual(["Policies", "Methodology"]);
    expect(tail.previousElementSibling).toHaveAttribute("aria-selected", "true");
    expect(tail.querySelector('[aria-selected="true"]')).toBeNull();
    // The last tab chosen: nothing after it, and no room kept after its copy
    const last = render(<ViewSkeleton view="outlook:living" viewTabs={viewTabs.slice(0, 3)} />).container;
    expect(last.querySelector(".skeleton-tab-tail")).toBeNull();
    expect(last.querySelector(".skeleton-tab-ghost")).toHaveClass("is-last");
  });

  it("starts both rows at the left when the first tab is chosen, as the real bar never scrolls for it", () => {
    const viewTabs = [
      { value: "dashboard", label: "Population impact" },
      { value: "household", label: "Household calculator" },
      { value: "outlook", label: "Current law" },
    ];
    const labels = (node) => [...node.querySelectorAll(".view-tab-label")].map((label) => label.textContent);
    const first = render(<ViewSkeleton view="dashboard:finances" viewTabs={viewTabs} />).container;
    const row = first.querySelector(".boot-view-tabs .view-tabs");
    expect(row).toHaveClass("is-at-start");
    expect(row.querySelector(".skeleton-tab-tail")).toBeNull();
    expect(labels(row)).toEqual(viewTabs.map(({ label }) => label));
    expect(first.querySelector(".skeleton-sub-tabs")).toHaveClass("has-tab-lead", "is-at-start");
    // A later tab chosen: the row ends 24px after it, as before
    const later = render(<ViewSkeleton view="outlook:living" viewTabs={viewTabs} />).container;
    expect(later.querySelector(".boot-view-tabs .view-tabs")).not.toHaveClass("is-at-start");
    expect(later.querySelector(".skeleton-sub-tabs")).not.toHaveClass("is-at-start");
    // The rules that hold them at the start
    const css = readFileSync(join(process.cwd(), "src", "components", "publication", "publication.css"), "utf8");
    expect(css).toMatch(/\.boot-view-tabs \.view-tabs\.is-at-start \{\s*justify-content: flex-start;\s*\}/);
    expect(css).toMatch(/\.skeleton-sub-tabs\.has-tab-lead\.is-at-start \{\s*grid-template-columns: max-content minmax\(0, 1fr\);\s*\}/);
  });

  it("puts every view's placeholder in the server's HTML, one per address", () => {
    const html = renderToString(<BootSkeleton />);
    for (const view of SKELETON_VIEWS) expect(html).toContain(`data-boot-variant="${view}"`);
    expect(html).toContain("Choose a household");
  });
});
