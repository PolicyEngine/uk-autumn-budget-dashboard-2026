import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../App";

const OUTLOOK = readFileSync(
  join(__dirname, "..", "..", "..", "public", "data", "living_standards_outlook.json"),
  "utf8",
);

beforeEach(() => {
  // The outlook JSON for the Living standards view; an empty CSV for the rest
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).endsWith("living_standards_outlook.json")
        ? new Response(OUTLOOK, { status: 200, headers: { "Content-Type": "application/json" } })
        : String(url).endsWith("manifest.json") ? new Response(null, { status: 404 }) : new Response("reform_id,year,value\n", { status: 200 }),
    ),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (container) => container.querySelector(".title-row");

describe("the Living standards view", () => {
  it("is the fourth view tab, and choosing it shows the outlook", async () => {
    const { container } = render(<App />);
    await screen.findByRole("tablist", { name: "Views" });
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toHaveAttribute("aria-hidden");
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[3]).toHaveTextContent("Living standards");
    fireEvent.click(tabs[3]);

    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Living standards" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    // Baseline outlook is the sub-tab it opens on
    expect(screen.getByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Forecast changes" })).toBeNull();
    // Its engine and data, said once on the view
    expect(screen.getAllByText(/Baseline from policyengine 6\.8\.0/)).toHaveLength(1);
    expect(window.location.search).toBe("?tab=living");
  });

  it("splits into Baseline outlook and Forecast changes sub-tabs, with the intro and data shared", async () => {
    window.history.replaceState({}, "", "/?tab=living");
    render(<App />);
    const subTabs = await screen.findByRole("tablist", { name: "Living standards sections" });
    const [baseline, forecast] = within(subTabs).getAllByRole("tab");
    expect([baseline, forecast].map((t) => t.textContent)).toEqual(["Baseline outlook", "Forecast changes"]);

    const panel = () => screen.getByRole("tabpanel", { name: /^(Baseline outlook|Forecast changes)$/ });
    expect(panel()).toHaveAccessibleName("Baseline outlook");
    for (const name of ["Incomes", "Poverty", "Child poverty", "What the baseline leaves out"]) {
      expect(within(panel()).getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(within(panel()).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();

    fireEvent.click(forecast);
    expect(forecast).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAccessibleName("Forecast changes");
    expect(within(panel()).getByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { level: 2, name: "Household income" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("heading", { name: "Incomes" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");

    // Shared by both: the provenance line above, the Data section below
    expect(screen.getAllByText(/Baseline from policyengine 6\.8\.0/)).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Data" })).toHaveLength(1);
    expect(within(panel()).queryByRole("heading", { name: "Data" })).toBeNull();

    fireEvent.click(baseline);
    expect(new URLSearchParams(window.location.search).has("sub")).toBe(false);
    expect(window.location.search).toBe("?tab=living");
  });

  it("opens the sub-tab a link names, and drops it on another view", async () => {
    window.history.replaceState({}, "", "/?tab=living&sub=forecast");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Forecast changes" })).toHaveAttribute("aria-selected", "true");
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");

    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("methodology");
    expect(params.has("sub")).toBe(false);

    // Back on Living standards, it opens at the default sub-tab
    fireEvent.click(screen.getByRole("tab", { name: "Living standards" }));
    expect(await screen.findByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens Baseline outlook for an unknown ?sub=", async () => {
    window.history.replaceState({}, "", "/?tab=living&sub=nonsense");
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?tab=living");
  });

  it("hides the year and policy pills but keeps the band's layout", async () => {
    window.history.replaceState({}, "", "/?tab=living");
    const { container } = render(<App />);
    await screen.findByRole("tablist", { name: "Views" });
    for (const selector of [".band-year", ".band-policy"]) {
      const pill = band(container).querySelector(selector);
      // Still in the band, holding its place, but hidden and out of reach
      expect(pill).toHaveClass("is-hidden");
      expect(pill).toHaveAttribute("aria-hidden", "true");
      expect(pill).toHaveAttribute("inert");
    }
    expect(screen.getByRole("tab", { name: "Living standards" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
