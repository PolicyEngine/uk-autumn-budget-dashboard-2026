import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import LifecycleCalculator, { resetSavedWizard } from "./LifecycleCalculator";

beforeEach(() => {
  resetSavedWizard();
});

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const toStep = (title) => {
  while (screen.getByRole("heading", { level: 3 }).textContent !== title) next();
};

describe("the personal impact form", () => {
  it("shows one step at a time and walks to the results", () => {
    render(<LifecycleCalculator />);
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).getByRole("button", { current: "step" })).toHaveTextContent(
      "About you",
    );
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
    expect(screen.queryByLabelText("Salary")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 3, name: "Earnings" })).toHaveFocus();
    expect(screen.getByLabelText("Salary")).toBeInTheDocument();

    // Jump back by the step tabs; later steps are not reachable yet
    expect(within(steps).getByRole("button", { name: /Family/ })).toBeDisabled();
    fireEvent.click(within(steps).getByRole("button", { name: /About you/ }));
    expect(screen.getByLabelText("Age")).toBeInTheDocument();

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("heading", { level: 3, name: "Results" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
  });

  it("fills the form from a young-person example, still editable", () => {
    render(<LifecycleCalculator />);
    fireEvent.click(screen.getByRole("button", { name: "A 22-year-old renting" }));
    expect(screen.getByRole("button", { name: "A 22-year-old renting" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Only the single-year effect uses rent/)).toBeInTheDocument();
    expect(screen.getByLabelText("Age")).toHaveValue("22");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Salary")).toHaveValue("25000");

    fireEvent.change(screen.getByLabelText("Salary"), { target: { value: "26000" } });
    expect(screen.getByLabelText("Salary")).toHaveValue("26000");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Edited: no longer the example as given
    expect(screen.queryByText(/Only the single-year effect uses rent/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "A 23-year-old graduate" }));
    expect(screen.getByText(/Plan 5, for courses starting from August 2023, is not modelled/)).toBeInTheDocument();
  });

  it("asks where you live first, and keeps seven steps", () => {
    render(<LifecycleCalculator />);
    expect(screen.getByLabelText("Region")).toHaveValue("LONDON");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "SCOTLAND" } });
    expect(screen.getByLabelText("Region")).toHaveValue("SCOTLAND");
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).getAllByRole("button").map((b) => b.textContent.replace(/^[0-9✓]+Step \d+: /, ""))).toEqual([
      "About you",
      "Earnings",
      "Other income",
      "Student loan",
      "Home and spending",
      "Family",
      "Results",
    ]);
  });

  it("asks the loan plan beside the balance", () => {
    render(<LifecycleCalculator />);
    toStep("Student loan");
    expect(screen.getByLabelText("Student loan plan")).toHaveValue("PLAN_2");
    const plans = within(screen.getByLabelText("Student loan plan"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(plans).toEqual([
      "No student loan",
      "Plan 1",
      "Plan 2",
      "Plan 4 (Scotland)",
      "Plan 5",
      "Postgraduate loan",
    ]);
    expect(screen.getByLabelText("Student loan debt")).toBeInTheDocument();
  });

  it("asks rent only of renters, with the optional details closed", () => {
    render(<LifecycleCalculator />);
    toStep("Home and spending");
    expect(screen.getByLabelText("Housing")).toHaveValue("RENT_PRIVATELY");
    expect(screen.getByLabelText("Monthly rent")).toHaveValue("900");
    fireEvent.change(screen.getByLabelText("Housing"), { target: { value: "OWNED_OUTRIGHT" } });
    expect(screen.queryByLabelText("Monthly rent")).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: "More details (optional)" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Council tax band")).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByLabelText("Council tax band")).toHaveValue("D");
    expect(screen.getByLabelText("Diesel spending")).toBeInTheDocument();
  });

  it("asks about a partner, Universal Credit and childcare in Family", () => {
    render(<LifecycleCalculator />);
    toStep("Family");
    expect(screen.queryByLabelText("Partner's salary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("I live with a partner"));
    expect(screen.getByLabelText("Partner's age")).toBeInTheDocument();
    expect(screen.getByLabelText("Partner's salary")).toHaveValue("25000");
    expect(screen.getByLabelText("My household claims Universal Credit")).not.toBeChecked();

    // Childcare is asked only with children, in the closed expander
    expect(screen.queryByRole("button", { name: "More details (optional)" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Children's ages"), { target: { value: "4, 7" } });
    fireEvent.click(screen.getByRole("button", { name: "More details (optional)" }));
    expect(screen.getByLabelText("Monthly childcare")).toHaveValue("0");
  });

  it("fills the new household answers from each example", () => {
    const cases = [
      ["A 22-year-old renting", { plan: "NONE", rent: "900" }],
      ["A 19-year-old apprentice", { plan: "NONE", rent: "600" }],
      ["A 23-year-old graduate", { plan: "PLAN_2", rent: "900" }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = render(<LifecycleCalculator />);
      // Start from answers the example must overwrite
      toStep("Family");
      fireEvent.click(screen.getByLabelText("I live with a partner"));
      fireEvent.click(screen.getByLabelText("My household claims Universal Credit"));
      fireEvent.click(within(screen.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: /About you/ }));
      fireEvent.click(screen.getByRole("button", { name: label }));

      expect(screen.getByLabelText("Region")).toHaveValue("LONDON");
      toStep("Student loan");
      expect(screen.getByLabelText("Student loan plan")).toHaveValue(expected.plan);
      toStep("Home and spending");
      expect(screen.getByLabelText("Housing")).toHaveValue("RENT_PRIVATELY");
      expect(screen.getByLabelText("Monthly rent")).toHaveValue(expected.rent);
      toStep("Family");
      expect(screen.getByLabelText("I live with a partner")).not.toBeChecked();
      expect(screen.getByLabelText("My household claims Universal Credit")).not.toBeChecked();
      expect(screen.getByLabelText("Children's ages")).toHaveValue("");
      unmount();
    }
  });
});
