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

  it("puts every view's placeholder in the server's HTML, one per address", () => {
    const html = renderToString(<BootSkeleton />);
    for (const view of SKELETON_VIEWS) expect(html).toContain(`data-boot-variant="${view}"`);
    expect(html).toContain("Choose a household");
  });

  it("gives every view its own layout, with no number in it", () => {
    for (const view of SKELETON_VIEWS) {
      const { container, unmount } = render(<ViewSkeleton view={view} />);
      // A view with no layout of its own falls back to Public finances'
      if (view !== "dashboard:finances") expect(container.querySelector("h2")).not.toHaveTextContent(/^Public finances$/);
      expect(container.textContent, view).not.toMatch(/£|\d/);
      unmount();
    }
  });

  it("shows Forecast vintages' placeholder with its heading and its sub-tab chosen", () => {
    const { container } = render(<ViewSkeleton view="outlook:vintages" />);
    expect(screen.getByRole("heading", { name: "OBR forecasts beside the outturn" })).toBeInTheDocument();
    expect(container.querySelector('.sub-tab[aria-selected="true"]')).toHaveTextContent("Forecast vintages");
  });

  it("shows each address's placeholder: the stylesheet has a rule for every view", () => {
    const css = readFileSync(join(__dirname, "publication.css"), "utf8");
    for (const view of SKELETON_VIEWS) {
      expect(css, view).toContain(`html[data-boot-view="${view}"] .boot-variant[data-boot-variant="${view}"]`);
    }
  });
});
