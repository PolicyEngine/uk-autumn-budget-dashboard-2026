import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import GeographyMethodology from "./GeographyMethodology";

describe("GeographyMethodology", () => {
  it("explains the checks, intervals and tiers", () => {
    const { container } = render(<GeographyMethodology />);
    const text = container.textContent;
    expect(text).toContain("at least 10 survey households");
    expect(text).toContain("dominance and p% rules");
    expect(text).toContain("resampling survey households while holding their weights fixed");
    expect(text).toContain("understate");
    expect(text).toContain("round figures to the precision the data supports");
    expect(text).toContain("protect the confidentiality of survey respondents");
    // The region view is hidden (b368c7e6): nothing compares with regional figures
    expect(text).not.toMatch(/regional ones|different dataset/);
    expect(text).toContain("not from the national file behind the other figures");
    expect(text).toContain("and carers, by region at most");
    expect(text).toContain("come from Microcosm's local-area dataset");
    expect(text).toContain("each household belongs to one constituency");
    expect(text).toContain("keeps its constituency in every year");
    expect(text).not.toContain("estimated for 2025");
    expect(text).toContain("little change: under 0.1% of income (£10 a year)");
    expect(text).not.toMatch(/noise/i);

    expect(text).toContain("HMRC pension-income amounts and recipient counts by constituency and local authority");
    expect(text).not.toContain("property, pension and road-fuel");
    expect(container.querySelector('a[href*="microcosm/issues/1131"]')).toBeNull();
  });

  it("says how constituency figures relate to the national ones", () => {
    const { container } = render(<GeographyMethodology />);
    const terms = [...container.querySelectorAll(".method-fact dt")].map((term) => term.textContent);
    // After the calibration the figures rest on, before the note on later years
    expect(terms.slice(-3)).toEqual(["Local calibration", "National figures", "Later years"]);
    const fact = [...container.querySelectorAll(".method-fact")].find(
      (item) => item.querySelector("dt").textContent === "National figures",
    );
    const points = [...fact.querySelectorAll("li")].map((point) => point.textContent);
    expect(points).toEqual([
      "We estimate constituency figures on the local-area file's own weights and do not scale them to the national figures, so a policy's constituency figures, taken together, need not match its national figure.",
      "The local-area file matches HMRC's totals of property, dividend and private pension income by income band less closely than the national file does, so maps for policies that act on those incomes rest on a looser fit.",
      "Use a constituency figure as an estimate of a policy's effect on households there. Its 90% interval reflects resampling with fitted weights held fixed; it leaves out uncertainty from calibration and differences between the two files. For a policy's total, use the national figures.",
    ]);
    // No size for the gap: no published file gives the local-area file's
    // national total, so the note states none
    expect(fact.textContent).not.toMatch(/\d(\.\d+)?% (above|below|higher|lower|more|less)|£\d/);
  });
});
