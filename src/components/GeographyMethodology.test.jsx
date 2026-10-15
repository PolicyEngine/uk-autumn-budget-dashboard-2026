import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GeographyMethodology, { METHOD_NOTE_URL } from "./GeographyMethodology";

describe("GeographyMethodology", () => {
  it("opens on request and explains the checks, intervals and tiers", () => {
    const { container } = render(<GeographyMethodology />);
    const toggle = screen.getByRole("button", {
      name: "How these figures are estimated",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.textContent).not.toContain("dominance");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const text = container.textContent;
    expect(text).toContain("at least 10 survey households");
    expect(text).toContain("dominance and p% rules");
    expect(text).toContain("resampling survey households with their weights held fixed");
    expect(text).toContain("understate");
    expect(text).toContain("rounded to the precision the data supports");
    expect(text).toContain("protect the confidentiality of survey respondents");
    expect(text).toContain("do not add up exactly to the regional ones");
    expect(text).toContain("may come from a different dataset");
    expect(text).toContain("little change is under 0.1% of income (£10 a year)");
    expect(text).not.toMatch(/noise/i);

    const link = screen.getByRole("link", {
      name: "Read the method note for constituency figures",
    });
    expect(link).toHaveAttribute("href", METHOD_NOTE_URL);
    expect(METHOD_NOTE_URL).toBe(
      "https://github.com/PolicyEngine/microcosm/issues/1131",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
