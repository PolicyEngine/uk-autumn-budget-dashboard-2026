import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SubTabs, { SubTabPanel, subPanelId, subTabId, useSubTabParam } from "./SubTabs";

const TABS = [
  { value: "single", label: "Single-year effect" },
  { value: "multi", label: "Multi-year effect" },
  { value: "third", label: "Third" },
];

function Harness() {
  const [value, setValue] = useSubTabParam(TABS.map((t) => t.value));
  return (
    <>
      <SubTabs tabs={TABS} value={value} onChange={setValue} ariaLabel="Effects" idPrefix="pi" />
      <SubTabPanel idPrefix="pi" value={value}>
        <p>Panel {value}</p>
      </SubTabPanel>
    </>
  );
}

const tab = (name) => screen.getByRole("tab", { name });
const sub = () => new URLSearchParams(window.location.search).get("sub");

beforeEach(() => {
  window.history.replaceState({}, "", "/?tab=personal");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SubTabs", () => {
  it("is a labelled tablist whose chosen tab controls the one panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Effects" })).toBeInTheDocument();
    expect(tab("Single-year effect")).toHaveAttribute("aria-selected", "true");
    expect(tab("Single-year effect")).toHaveAttribute("tabindex", "0");
    expect(tab("Single-year effect")).toHaveAttribute("id", subTabId("pi", "single"));
    expect(tab("Single-year effect")).toHaveAttribute("aria-controls", subPanelId("pi", "single"));
    expect(tab("Multi-year effect")).toHaveAttribute("aria-selected", "false");
    expect(tab("Multi-year effect")).toHaveAttribute("tabindex", "-1");
    expect(tab("Multi-year effect")).not.toHaveAttribute("aria-controls");
    const panel = screen.getByRole("tabpanel", { name: "Single-year effect" });
    expect(panel).toHaveAttribute("id", subPanelId("pi", "single"));
    expect(panel).toHaveTextContent("Panel single");
  });

  it("moves with Left, Right (wrapping), Home and End, and focuses the tab", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Multi-year effect")).toHaveAttribute("aria-selected", "true");
    expect(tab("Multi-year effect")).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Single-year effect")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab("Single-year effect")).toHaveAttribute("aria-selected", "true");
    expect(tab("Single-year effect")).toHaveFocus();
    // Other keys do nothing
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("Single-year effect")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps ?sub= in step, writing nothing for the default and keeping other params", () => {
    render(<Harness />);
    expect(window.location.search).toBe("?tab=personal");
    fireEvent.click(tab("Multi-year effect"));
    expect(sub()).toBe("multi");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("personal");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel multi");
    fireEvent.click(tab("Single-year effect"));
    expect(window.location.search).toBe("?tab=personal");
  });

  it("opens the sub-tab the address names, and the default for an unknown one", () => {
    window.history.replaceState({}, "", "/?tab=personal&sub=third#x");
    const { unmount } = render(<Harness />);
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#x");
    unmount();

    window.history.replaceState({}, "", "/?tab=personal&sub=bogus");
    render(<Harness />);
    expect(tab("Single-year effect")).toHaveAttribute("aria-selected", "true");
    expect(sub()).toBeNull();
  });

  it("brings the bar back under the sticky band only if the reader had scrolled past it", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<Harness />);
    const list = screen.getByRole("tablist");
    // Not scrolled past: the page stays put
    fireEvent.click(tab("Multi-year effect"));
    expect(scrollTo).not.toHaveBeenCalled();

    // Scrolled 800px down, with the bar 500px down the page under a 112px band
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: -300 });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
      el === list ? { scrollMarginTop: "124px" } : computed(el, pseudo),
    );
    Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
    fireEvent.click(tab("Third"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 500 - 124 });
    // Choosing the open tab does not scroll
    scrollTo.mockClear();
    fireEvent.click(tab("Third"));
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.unstubAllGlobals();
  });
});
