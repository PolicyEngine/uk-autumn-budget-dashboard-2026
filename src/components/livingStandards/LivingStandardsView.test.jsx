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
  it("is the third option in the view pill, and switching to it shows the outlook", async () => {
    const { container } = render(<App />);
    // The Population view has the year and policy pills
    expect(band(container).querySelector(".band-year")).not.toBeNull();
    expect(band(container).querySelector(".band-policy")).not.toHaveAttribute("aria-hidden");

    fireEvent.click(screen.getByRole("button", { name: "View: Population impact" }));
    const options = within(screen.getByRole("listbox", { name: "View" })).getAllByRole("option");
    expect(options.map((option) => option.textContent.replace("✓", ""))).toEqual([
      "Population impact",
      "Personal impact",
      "Living standards",
    ]);
    fireEvent.click(options[2]);

    expect(screen.getByRole("button", { name: "View: Living standards" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Living standards" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Incomes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Forecast changes" })).toBeInTheDocument();
    // Its engine and data, said once on the view
    expect(screen.getAllByText(/Baseline from policyengine 6\.8\.0/)).toHaveLength(1);
    expect(window.location.search).toBe("?tab=living");
  });

  it("hides the year and policy pills but keeps the band's layout", () => {
    window.history.replaceState({}, "", "/?tab=living");
    const { container } = render(<App />);
    expect(band(container).querySelector(".band-year")).toBeNull();
    const policy = band(container).querySelector(".band-policy");
    // Still in the band, holding its place, but hidden and out of reach
    expect(policy).toHaveClass("is-hidden");
    expect(policy).toHaveAttribute("aria-hidden", "true");
    expect(policy).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "View: Living standards" })).toBeInTheDocument();
  });
});
