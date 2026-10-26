import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SectionHeading, { sectionSlug } from "./SectionHeading";

describe("SectionHeading", () => {
  it("keeps the heading's name to its title, with the icon hidden", () => {
    const { container } = render(
      <SectionHeading icon="scale" title="Inequality" subtitle="Inequality under current law." />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Inequality" })).toBeInTheDocument();
    const icon = container.querySelector(".section-icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Inequality under current law.")).toBeInTheDocument();
  });

  it("takes its id from the title unless given one", () => {
    const { container, rerender } = render(<SectionHeading title="Who gains and from what" />);
    expect(container.firstChild).toHaveAttribute("id", "who-gains-and-from-what");
    rerender(<SectionHeading id="pensioners-who-gains" title="Who gains and from what" />);
    expect(container.firstChild).toHaveAttribute("id", "pensioners-who-gains");
    expect(sectionSlug("Incomes under current law")).toBe("incomes-under-current-law");
  });

  it("shows the with/without-the-measures pill outside the heading", () => {
    render(<SectionHeading tag="current-law" title="Poverty under current law" />);
    expect(screen.getByText("Without the measures")).toHaveClass("section-tag-current-law");
    expect(screen.getByRole("heading", { name: "Poverty under current law" })).toBeInTheDocument();
  });

  it("links to the section, and copies the link on click", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    window.history.replaceState({}, "", "/?tab=population&sub=all");
    render(<SectionHeading title="Public finances" />);
    const link = screen.getByRole("link", { name: /Copy a link to .Public finances./ });
    expect(link).toHaveAttribute("href", "#public-finances");
    await act(async () => {
      fireEvent.click(link);
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\?tab=population&sub=all#public-finances$/));
    expect(window.location.hash).toBe("#public-finances");
    expect(link).toHaveTextContent("Copied");
  });
});
