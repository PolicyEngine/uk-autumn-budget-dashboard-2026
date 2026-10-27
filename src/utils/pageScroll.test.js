import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STICKY_GAP,
  isProgrammaticScroll,
  resetPageScroll,
  scrollBelowBars,
  scrollTopFor,
  stickyBottom,
} from "./pageScroll";

const NAV_SHELL = "min-h-screen flex flex-col";

// A bar at [top, bottom] of the window
const bar = (className, top, bottom, parent = document.body) => {
  const el = document.createElement("div");
  el.className = className;
  parent.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top, bottom, height: bottom - top });
  return el;
};

const at = (top) => {
  const el = document.createElement("div");
  document.body.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 40, height: 40 });
  return el;
};

describe("pageScroll", () => {
  let scrollTo;
  beforeEach(() => {
    resetPageScroll();
    scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true, writable: true });
    // Frames wait, so only the first scroll is seen
    vi.stubGlobal("requestAnimationFrame", () => 0);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-site-nav-shown");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetPageScroll();
  });

  it("measures the bars from the page: the lowest bottom of those shown", () => {
    expect(stickyBottom()).toBe(0);
    bar("title-row", 0, 64);
    bar("view-tabs-bar", 64, 104);
    bar("sub-tabs-band", 104, 145);
    expect(stickyBottom()).toBe(145);
  });

  it("counts the site nav when it is in, and not when it is hidden above the window", () => {
    const shell = document.createElement("div");
    shell.className = NAV_SHELL;
    document.body.append(shell);
    const nav = bar("", -58, 0, shell);
    nav.setAttribute("style", "position: sticky");
    const title = bar("title-row", 0, 64);
    expect(stickyBottom()).toBe(64);
    // In: the bars move down under it
    nav.getBoundingClientRect.mockReturnValue({ top: 0, bottom: 58, height: 58 });
    title.getBoundingClientRect.mockReturnValue({ top: 58, bottom: 122, height: 64 });
    expect(stickyBottom()).toBe(122);
  });

  it("leaves out bars not shown and, for a sentinel, the bars below it", () => {
    bar("title-row", 0, 64);
    const hidden = bar("view-tabs-bar", 64, 104);
    hidden.style.display = "none";
    expect(stickyBottom()).toBe(64);
    const sentinel = document.createElement("div");
    document.body.append(sentinel);
    bar("sub-tabs-band", 64, 105);
    expect(stickyBottom()).toBe(105);
    expect(stickyBottom({ above: sentinel })).toBe(64);
  });

  it("scrolls a heading to 16px below the bars, from where it is now", () => {
    bar("title-row", 0, 64);
    bar("view-tabs-bar", 64, 104);
    const heading = at(300);
    expect(scrollTopFor(heading)).toBe(1000 + 300 - 104 - STICKY_GAP);
    scrollBelowBars(heading, { behavior: "smooth" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1180, behavior: "smooth" });
  });

  it("with onlyUp, scrolls only when the target has gone up under the bars", () => {
    bar("title-row", 0, 64);
    scrollBelowBars(at(400), { gap: 0, onlyUp: true });
    expect(scrollTo).not.toHaveBeenCalled();
    scrollBelowBars(at(10), { gap: 0, onlyUp: true });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 10 - 64, behavior: "auto" });
  });

  it("marks its own scroll, so the site nav does not take it for the reader's", () => {
    bar("title-row", 0, 64);
    expect(isProgrammaticScroll(500)).toBe(false);
    scrollBelowBars(at(-400));
    expect(isProgrammaticScroll(900)).toBe(true);
    expect(isProgrammaticScroll(1000 - 400 - 64 - 16)).toBe(true);
  });

  it("at the page's top, takes the shown site nav away rather than leave the heading under it", () => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
    const root = document.documentElement;
    root.setAttribute("data-site-nav-shown", "");
    const title = bar("title-row", 58, 122);
    // The heading's place in the page is 100px down: under the bars with the nav in
    const heading = at(100);
    // Once the nav goes the band moves back up
    const removeAttribute = root.removeAttribute.bind(root);
    vi.spyOn(root, "removeAttribute").mockImplementation((name) => {
      removeAttribute(name);
      title.getBoundingClientRect.mockReturnValue({ top: 0, bottom: 64, height: 64 });
    });
    scrollBelowBars(heading);
    expect(root.hasAttribute("data-site-nav-shown")).toBe(false);
    expect(scrollTopFor(heading)).toBe(100 - 64 - 16);
    expect(scrollTo).toHaveBeenCalledWith({ top: 20, behavior: "auto" });
  });
});
