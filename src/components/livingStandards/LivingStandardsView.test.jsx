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
    expect(screen.getByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    // Its engine and data, said once on the view
    expect(screen.getAllByText(/Baseline from policyengine 6\.8\.0/)).toHaveLength(1);
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
