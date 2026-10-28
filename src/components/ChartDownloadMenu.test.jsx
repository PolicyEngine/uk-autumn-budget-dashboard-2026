import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChartDownloadMenu from "./ChartDownloadMenu";

const originalScroll = Element.prototype.scrollIntoView;
afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll;
  vi.restoreAllMocks();
});

/** The menu's list, its bottom at `bottom` px from the window's top. */
function openAt(bottom) {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.classList?.contains("chart-download-menu") ? { top: bottom - 130, bottom, height: 130 } : rect.call(this);
  });
  render(<ChartDownloadMenu chartTitle="Household net income" formats={{ csv: () => {}, png: () => {} }} />);
  fireEvent.click(screen.getByRole("button", { name: "Download chart: Household net income" }));
  return scroll;
}

describe("ChartDownloadMenu on a phone (phone check)", () => {
  it("brings a list that opens below the fold into view", async () => {
    const scroll = openAt(window.innerHeight + 120);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" })));
  });

  it("leaves the page where it is when the list already shows", async () => {
    const scroll = openAt(300);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scroll).not.toHaveBeenCalled();
  });
});
