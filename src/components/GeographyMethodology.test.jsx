import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import GeographyMethodology, { METHOD_NOTE_URL } from "./GeographyMethodology";

describe("GeographyMethodology", () => {
  it("explains the checks, intervals and tiers", () => {
    const { container } = render(<GeographyMethodology />);
    const text = container.textContent;
    expect(text).toContain("at least 10 survey households");
    expect(text).toContain("dominance and p% rules");
    expect(text).toContain("resampling survey households with their weights held fixed");
    expect(text).toContain("understate");
    expect(text).toContain("rounded to the precision the data supports");
    expect(text).toContain("protect the confidentiality of survey respondents");
    // The region view is hidden (b368c7e6): nothing compares with regional figures
    expect(text).not.toMatch(/regional ones|different dataset/);
    expect(text).toContain("not from the national file behind the other figures");
    expect(text).toContain("calibrated by region at most");
    expect(text).toContain("come from Microcosm's local-area dataset");
    expect(text).toContain("each household belongs to one constituency");
    expect(text).toContain("keeps its constituency in every year");
    expect(text).not.toContain("estimated for 2025");
    expect(text).toContain("little change: under 0.1% of income (£10 a year)");
    expect(text).not.toMatch(/noise/i);

    const link = screen.getByRole("link", {
      name: /^Read the method note for constituency figures/,
    });
    expect(link).toHaveAttribute("href", METHOD_NOTE_URL);
    expect(METHOD_NOTE_URL).toBe(
      "https://github.com/PolicyEngine/microcosm/issues/1131",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
