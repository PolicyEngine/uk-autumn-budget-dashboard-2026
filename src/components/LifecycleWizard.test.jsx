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
});
