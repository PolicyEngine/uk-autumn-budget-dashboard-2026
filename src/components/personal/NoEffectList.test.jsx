import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoEffectList } from "./PolicyBars";

// The "No effect" list in a card's About this chart (MeasuresCard,
// Pensioners, the household calculator's bars): a policy out of force
// that year gives when it is in force after a colon, as the list in
// every other card's About (ChartMoreInfo zeroMeasuresItem) does, with no
// dash in the caveat.
describe("NoEffectList", () => {
  it("gives a row's reason after a colon, lower-cased, without its full stop", () => {
    render(
      <NoEffectList
        title="No effect in 2028-29"
        items={[
          { id: "threshold_freeze", name: "Threshold freeze", reason: "From April 2031." },
          { id: "salary_sacrifice_cap", name: "Salary sacrifice cap" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    const rows = [...document.querySelectorAll(".no-effect-item")].map((row) => row.textContent);
    expect(rows).toEqual(["Threshold freeze: from April 2031", "Salary sacrifice cap"]);
    expect(document.querySelector(".no-effect").textContent).not.toMatch(/[—–]/);
  });
});
