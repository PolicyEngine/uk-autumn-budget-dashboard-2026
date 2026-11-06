import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SubTabs, { SubTabPanel, subPanelId, subTabId, useSubTabParam } from "./SubTabs";

const TABS = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
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
  window.history.replaceState({}, "", "/?tab=living");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SubTabs", () => {
  it("is a labelled tablist whose chosen tab controls the one panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Effects" })).toBeInTheDocument();
    expect(tab("First")).toHaveAttribute("aria-selected", "true");
    expect(tab("First")).toHaveAttribute("tabindex", "0");
    expect(tab("First")).toHaveAttribute("id", subTabId("pi", "first"));
    expect(tab("First")).toHaveAttribute("aria-controls", subPanelId("pi", "first"));
    expect(tab("Second")).toHaveAttribute("aria-selected", "false");
    expect(tab("Second")).toHaveAttribute("tabindex", "-1");
    expect(tab("Second")).not.toHaveAttribute("aria-controls");
    const panel = screen.getByRole("tabpanel", { name: "First" });
    expect(panel).toHaveAttribute("id", subPanelId("pi", "first"));
    expect(panel).toHaveTextContent("Panel first");
  });

  it("moves with Left, Right (wrapping), Home and End, and focuses the tab", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Second")).toHaveAttribute("aria-selected", "true");
    expect(tab("Second")).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("First")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab("First")).toHaveAttribute("aria-selected", "true");
    expect(tab("First")).toHaveFocus();
    // Other keys do nothing
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("First")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps ?sub= in step, writing nothing for the default and keeping other params", () => {
    render(<Harness />);
    expect(window.location.search).toBe("?tab=living");
    fireEvent.click(tab("Second"));
    expect(sub()).toBe("second");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("living");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel second");
    fireEvent.click(tab("First"));
    expect(window.location.search).toBe("?tab=living");
  });

  it("opens the sub-tab the address names, and the default for an unknown one", () => {
    window.history.replaceState({}, "", "/?tab=living&sub=third#x");
    const { unmount } = render(<Harness />);
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#x");
    unmount();

    window.history.replaceState({}, "", "/?tab=living&sub=bogus");
    render(<Harness />);
    expect(tab("First")).toHaveAttribute("aria-selected", "true");
    expect(sub()).toBeNull();
  });

  it("brings the bar back under the sticky band only if the reader had scrolled past it", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<Harness />);
    // The band sticks: its place in the page is the sentinel before it,
    // lined up under the bars above it, measured live (utils/pageScroll)
    const band = screen.getByRole("tablist").closest(".sub-tabs-band");
    const sentinel = band.previousElementSibling;
    expect(sentinel).toHaveClass("sub-tabs-sentinel");
    // Not scrolled past: the page stays put
    fireEvent.click(tab("Second"));
    expect(scrollTo).not.toHaveBeenCalled();

    // Scrolled 800px down, with the bar 500px down the page under a 124px
    // title band (the band itself sits below the sentinel, so it does not count)
    const title = document.createElement("div");
    title.className = "title-row";
    document.body.prepend(title);
    vi.spyOn(title, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 124, height: 124 });
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue({ top: 124, bottom: 173, height: 49 });
    vi.spyOn(sentinel, "getBoundingClientRect").mockReturnValue({ top: -300 });
    Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
    fireEvent.click(tab("Third"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 500 - 124, behavior: "auto" });
    // Choosing the open tab does not scroll
    scrollTo.mockClear();
    fireEvent.click(tab("Third"));
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    title.remove();
    vi.unstubAllGlobals();
  });

  it("opens a sub-tab for a link in a panel as choosing it does, and focuses the tab", () => {
    // The link sits in the panel it leaves, as Forecast vintages' link to
    // Forecast changes does
    function LinkHarness() {
      const [value, setValue] = useSubTabParam(TABS.map((t) => t.value));
      const bar = useRef(null);
      return (
        <>
          <SubTabs ref={bar} tabs={TABS} value={value} onChange={setValue} ariaLabel="Effects" idPrefix="pi" />
          <SubTabPanel idPrefix="pi" value={value}>
            <button type="button" onClick={() => bar.current.show("third")}>
              To the third
            </button>
          </SubTabPanel>
        </>
      );
    }
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<LinkHarness />);
    // The band sticks: its place in the page is the sentinel before it,
    // lined up under the bars above it, measured live (utils/pageScroll):
    // scrolled 800px down, with the bar 500px down the page under a 124px
    // title band, as in the test above
    const band = screen.getByRole("tablist").closest(".sub-tabs-band");
    const title = document.createElement("div");
    title.className = "title-row";
    document.body.prepend(title);
    vi.spyOn(title, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 124, height: 124 });
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue({ top: 124, bottom: 173, height: 49 });
    vi.spyOn(band.previousElementSibling, "getBoundingClientRect").mockReturnValue({ top: -300 });
    Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
    const link = screen.getByRole("button", { name: "To the third" });
    link.focus();
    fireEvent.click(link);
    expect(tab("Third")).toHaveAttribute("aria-selected", "true");
    expect(sub()).toBe("third");
    expect(tab("Third")).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledWith({ top: 500 - 124, behavior: "auto" });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    title.remove();
    vi.unstubAllGlobals();
  });

  it("sits in its band, with one sliding pill hidden from assistive tech and labels kept as names", () => {
    const { container } = render(<Harness />);
    const band = container.querySelector(".sub-tabs-band");
    expect(band).toContainElement(screen.getByRole("tablist"));
    const pill = band.querySelectorAll(".sub-tabs-pill");
    expect(pill).toHaveLength(1);
    expect(pill[0]).toHaveAttribute("aria-hidden", "true");
    // The pill is not a tab, and every tab keeps its label as its name
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    for (const { label } of TABS) expect(tab(label)).toBeInTheDocument();
  });
});
