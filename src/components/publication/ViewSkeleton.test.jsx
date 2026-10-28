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
  // of About and the tabs before the chosen one (publication.css)
  it("starts its sub-tab row under the chosen view tab, after an unseen copy of About and the tabs before it", () => {
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
    expect(lead.nextElementSibling).toHaveClass("sub-tabs");
    expect(labels(lead)).toEqual(["About", "Population impact", "Household calculator"]);
    expect(lead.querySelector(".edge-about")).toBeTruthy();
    expect(band.closest('[aria-hidden="true"]')).toBe(band);
    // The first view: About alone
    const dashboard = render(<ViewSkeleton view="dashboard:finances" viewTabs={viewTabs} />).container;
    expect(labels(dashboard.querySelector(".skeleton-tab-lead"))).toEqual(["About"]);
    // With no copy of the bar (the real one is on the page), the row takes
    // the real bar's --view-tab-x as before
    const bare = render(<ViewSkeleton view="outlook:living" />).container;
    expect(bare.querySelector(".skeleton-tab-lead")).toBeNull();
    expect(bare.querySelector(".skeleton-sub-tabs")).not.toHaveClass("has-tab-lead");
  });

  it("puts every view's placeholder in the server's HTML, one per address", () => {
    const html = renderToString(<BootSkeleton />);
    for (const view of SKELETON_VIEWS) expect(html).toContain(`data-boot-variant="${view}"`);
    expect(html).toContain("Choose a household");
  });
});
