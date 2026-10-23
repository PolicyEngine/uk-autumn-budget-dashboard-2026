import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LifecycleCalculator from "./LifecycleCalculator";

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
    expect(screen.getByText(/Rent is not an input/)).toBeInTheDocument();
    expect(screen.getByLabelText("Age")).toHaveValue("22");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Salary")).toHaveValue("25000");

    fireEvent.change(screen.getByLabelText("Salary"), { target: { value: "26000" } });
    expect(screen.getByLabelText("Salary")).toHaveValue("26000");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Edited: no longer the example as given
    expect(screen.queryByText(/Rent is not an input/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "A 23-year-old graduate" }));
    expect(screen.getByText(/Plan 5, for courses starting from August 2023, is not modelled/)).toBeInTheDocument();
  });
});
