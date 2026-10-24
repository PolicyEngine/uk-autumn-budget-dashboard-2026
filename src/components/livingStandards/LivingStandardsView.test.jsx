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
        : new Response("reform_id,year,value\n", { status: 200 }),
    ),
  );
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const band = (container) => container.querySelector(".title-row");

describe("the Living standards view", () => {
  it("is the third view tab, and choosing it shows the outlook", async () => {
    const { container } = render(<App />);
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toHaveAttribute("aria-hidden");
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[2]).toHaveTextContent("Living standards");
    fireEvent.click(tabs[2]);

    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Living standards" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    // Baseline outlook is the sub-tab it opens on
    expect(screen.getByRole("tab", { name: "Baseline outlook" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Forecast changes" })).toBeNull();
    // Its engine and data are said in Methodology, not on this view
    expect(screen.queryByText(/policyengine 6\.8\.0/)).toBeNull();
    expect(screen.queryByText("Demo")).toBeNull();
    expect(window.location.search).toBe("?tab=living");
  });

  it("splits into Baseline outlook and Forecast changes sub-tabs, with the intro shared", async () => {
    window.history.replaceState({}, "", "/?tab=living");
    render(<App />);
    const subTabs = await screen.findByRole("tablist", { name: "Living standards sections" });
    const [baseline, forecast] = within(subTabs).getAllByRole("tab");
    expect([baseline, forecast].map((t) => t.textContent)).toEqual(["Baseline outlook", "Forecast changes"]);

    const panel = () => screen.getByRole("tabpanel", { name: /^(Baseline outlook|Forecast changes)$/ });
    expect(panel()).toHaveAccessibleName("Baseline outlook");
    for (const name of ["Incomes", "Poverty"]) {
      expect(within(panel()).getByRole("heading", { name })).toBeInTheDocument();
    }
    // Child poverty by family sits beside Poverty by family type; the
    // two-child limit card, the caveats and the data notes are gone
    const byGroup = await within(panel()).findByRole("heading", { level: 3, name: "Poverty by family type" });
    const byFamily = within(panel()).getByRole("heading", { level: 3, name: "Child poverty by family" });
    expect(byGroup.closest(".charts-grid")).toBe(byFamily.closest(".charts-grid"));
    for (const name of ["Child poverty", "What the baseline leaves out", "Data"]) {
      expect(screen.queryByRole("heading", { level: 2, name })).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "Two-child limit" })).toBeNull();
    // Series notes sit in the cards, not between sections
    const income = within(panel()).getByRole("heading", { level: 3, name: "Household income" }).closest(".ls-card");
    expect(within(income).getByText(/^Series end in 2029-30/)).toBeInTheDocument();
    expect(panel().querySelector(".ls-section > .note")).toBeNull();
    expect(within(panel()).queryByRole("heading", { level: 2, name: "Household income" })).toBeNull();

    fireEvent.click(forecast);
    expect(forecast).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAccessibleName("Forecast changes");
    expect(within(panel()).getByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { level: 2, name: "Household income" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("heading", { name: "Incomes" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("sub")).toBe("forecast");


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

  it("states its engine, data, status, notes and gaps once, in Methodology", async () => {
    window.history.replaceState({}, "", "/?tab=methodology");
    render(<App />);
    const section = await screen.findByRole("region", { name: "Living standards" });
    expect(await within(section).findByText("policyengine 6.10.2 (policyengine-uk 2.132.6)")).toBeInTheDocument();
    expect(within(section).getByText(/Microcosm UK national \(19 Oct 2026, 6cba5d71\)/)).toBeInTheDocument();
    expect(within(section).getByText(/Demo output, unvalidated/)).toBeInTheDocument();
    expect(within(section).getByText(/2026-27 prices/)).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: "What the baseline leaves out" })).toBeInTheDocument();
    expect(document.body.textContent.match(/unvalidated/gi)).toHaveLength(1);
  });

  it("hides the year and policy pills but keeps the band's layout", () => {
    window.history.replaceState({}, "", "/?tab=living");
    const { container } = render(<App />);
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
