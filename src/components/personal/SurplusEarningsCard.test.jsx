import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SurplusEarningsCard from "./SurplusEarningsCard";
import { normaliseSurplusEarnings } from "../../utils/surplusEarnings";
import { SURPLUS_BLOCK, SURPLUS_NOT_REACHED } from "../../test/surplusEarningsFixture";

const card = () => screen.getByRole("region", { name: /^Universal Credit month by month/ });
/** A month's row of the table, by its month ("September 2027"). */
const row = (month) =>
  within(card())
    .getAllByRole("row")
    .find((tableRow) => within(tableRow).queryByRole("rowheader", { name: month }));

describe("the Universal Credit month by month card", () => {
  it("shows each month at both thresholds, where the award ends and starts again, and the change", () => {
    render(<SurplusEarningsCard surplus={normaliseSurplusEarnings(SURPLUS_BLOCK)} asked yearLabel="2027-28" />);
    expect(screen.getByRole("heading", { name: "Universal Credit month by month, 2027-28" })).toBeInTheDocument();
    // The change, said once, signed, with both totals
    expect(card()).toHaveTextContent("+£482");
    expect(card()).toHaveTextContent("£10,951 over the year with the Budget's £2,500 threshold, against £10,469 at the £300 threshold");
    // Twelve months, April to March, under their headings
    const table = within(card()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Month",
      "Pay",
      "Earned income",
      "Nil above",
      "Current law (£300)",
      "Budget (£2,500)",
    ]);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(12);
    // September's pay ends the award at both; £876 carried at £300 only
    const september = row("September 2027");
    expect(september).toHaveTextContent("£6,000");
    const [currentLaw, budget] = within(september).getAllByRole("cell").slice(-2);
    expect(currentLaw).toHaveTextContent("£0");
    expect(currentLaw).toHaveTextContent("Award ends; £876 carried");
    expect(budget).toHaveTextContent("Award ends");
    expect(budget).not.toHaveTextContent("carried");
    // October's claim: a new award at both, smaller at £300
    const [octoberCurrent, octoberBudget] = within(row("October 2027")).getAllByRole("cell").slice(-2);
    expect(octoberCurrent).toHaveTextContent("£514");
    expect(octoberCurrent).toHaveTextContent("New award; £876 counted");
    expect(octoberBudget).toHaveTextContent("£996");
    expect(octoberBudget).toHaveTextContent("New award");
    // A month on an award says nothing more
    expect(within(row("April 2027")).getAllByRole("cell").at(-1)).toHaveTextContent(/^£996$/);
    // How it is worked out
    expect(card()).toHaveTextContent("Worked out month by month");
  });

  it("says why the measure changes nothing for a household it cannot reach, with no months", () => {
    render(<SurplusEarningsCard surplus={normaliseSurplusEarnings(SURPLUS_NOT_REACHED)} asked yearLabel="2028-29" />);
    expect(card()).toHaveTextContent("No change in 2028-29");
    expect(card()).toHaveTextContent("The threshold is the same with or without the Budget in this year");
    expect(within(card()).queryByRole("table")).toBeNull();
  });

  it("says the figures are unavailable, never £0, when the answer has none though the months were sent", () => {
    render(<SurplusEarningsCard surplus={null} asked yearLabel="2027-28" />);
    expect(card()).toHaveTextContent("unavailable");
    expect(card()).toHaveTextContent("Your result leaves this measure out");
    expect(card()).not.toHaveTextContent("£0");
    expect(within(card()).queryByRole("table")).toBeNull();
  });

  it("shows nothing for a household that sent no months", () => {
    const { container } = render(<SurplusEarningsCard surplus={null} asked={false} yearLabel="2027-28" />);
    expect(container).toBeEmptyDOMElement();
  });
});
