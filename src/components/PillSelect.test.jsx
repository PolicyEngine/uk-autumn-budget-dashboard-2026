import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PillSelect from "./PillSelect";

describe("PillSelect", () => {
  it("marks the chosen option by aria-selected only, never with a tick mark", () => {
    render(
      <PillSelect
        name="Shown"
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "First" },
          { value: "b", label: "Second" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Shown: Second" }));
    const list = screen.getByRole("listbox", { name: "Shown" });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["First", "Second"]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(list.textContent).not.toMatch(/[✓✔]/);
  });
});
