import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import App, { preloadAllViews } from "./App";
import { SITE_NAV_DWELL_MS, resetPageScroll, scrollPageTo } from "./utils/pageScroll";

// Every view's code is in before a test renders it (App.jsx lazyView)
beforeAll(preloadAllViews, 60_000);

const SELECTOR =
  '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';
const css = () => readFileSync(join(__dirname, "app", "globals.css"), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the ui-kit shell's sticky site nav", () => {
  it("is still matched by the selector globals.css moves it with", () => {
    const { container } = render(
      <PolicyEngineShell country="uk" showFooter={false}>
        <p>content</p>
      </PolicyEngineShell>,
    );
    expect(container.querySelector(SELECTOR)).not.toBeNull();
  });

  it("uses the same selector in globals.css and App.jsx", () => {
    const app = readFileSync(join(__dirname, "App.jsx"), "utf8");
    expect(css()).toContain(SELECTOR);
    expect(app).toContain(`'${SELECTOR}'`);
  });

  it("is fixed and hidden above the window by default, and the bars sit under it once shown", () => {
    const sheet = css();
    // In the flow (relative) only on a touch-only device, where it scrolls
    // away with the page and never covers the top of a view (Budget day)
    const touch = sheet.indexOf("@media (hover: none) and (pointer: coarse) {\n  html[data-site-nav-shown]");
    expect(touch).toBeGreaterThan(-1);
    expect(sheet.indexOf("position: relative !important")).toBeGreaterThan(touch);
    expect(sheet.slice(touch, touch + 200)).toMatch(/--nav-offset: 0px;/);
    expect(sheet).toMatch(/position: fixed !important;\s*top: 0 !important;/);
    expect(sheet).toContain(`:root:not([data-site-nav-shown]) ${SELECTOR} {\n  transform: translateY(-100%);`);
    expect(sheet).toMatch(/:root \{\s*--nav-offset: 0px;\s*\}/);
    // Shown, the nav moves the band and tab rows down by its height, so it
    // never covers the Year and Policies pills (Pavel's review, HDR1)
    // (html[...], not :root[...]: the CSS build folds a :root[attr] custom
    // property rule into :root and drops it)
    expect(sheet).toMatch(/html\[data-site-nav-shown\] \{\s*--nav-offset: var\(--site-nav-height, 0px\);/);
    expect(sheet).toMatch(/:root\[data-site-nav-shown\] \.min-h-screen\.flex\.flex-col > div:first-child\[style\*="sticky"\] \{\s*box-shadow/);
    expect(sheet).toMatch(/\.title-row \{\s*position: sticky;\s*top: var\(--nav-offset\);/);
    expect(sheet).toMatch(/\.view-tabs-bar \{\s*position: sticky;\s*top: calc\(var\(--nav-offset\) \+ var\(--title-row-height\)\);/);
    expect(sheet).toContain("--sticky-offset: calc(var(--nav-offset) + var(--title-row-height) + var(--view-tabs-height) + var(--sub-band-height));");
    expect(sheet).toMatch(/transition: transform var\(--motion-slide\) var\(--ease-out\)/);
    // The band tucks away only on a phone on its side
    const landscape = sheet.indexOf("@media (orientation: landscape) and (max-height: 500px) {");
    expect(landscape).toBeGreaterThan(-1);
    expect(sheet.indexOf(".app[data-band-hidden]")).toBeGreaterThan(landscape);
    expect(sheet).not.toContain("data-site-nav-hidden");
  });
});

describe("showing the site nav", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.matchMedia;
  });

  const setup = (inShell = false, { touchOnly = false } = {}) => {
    window.matchMedia = (query) => ({
      matches: touchOnly && query === "(hover: none) and (pointer: coarse)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    vi.stubGlobal("fetch", async () => new Promise(() => {}));
    // Runs the frame at once; 0 so the next scroll asks for another
    vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 0; });
    window.history.replaceState({}, "", "/");
    window.scrollY = 0;
    render(inShell ? (
      <PolicyEngineShell country="uk" showFooter={false}><App /></PolicyEngineShell>
    ) : <App />);
    // No scroll the page made is left over from another test
    resetPageScroll();
    const root = document.documentElement;
    // The reader scrolling (a wheel or trackpad, then the scroll), and the
    // page moving by itself (a layout shift, scroll anchoring: no input)
    const scrollTo = (y) => act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: y - window.scrollY }));
      window.scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });
    const shift = (y) => act(() => {
      window.scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });
    const wait = (ms) => act(() => vi.advanceTimersByTime(ms));
    const shown = () => root.hasAttribute("data-site-nav-shown");
    const nav = () => document.querySelector(SELECTOR);
    // Off the nav, at clientY; or over the nav (from one of its links)
    const move = (clientY) => act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY }));
    });
    // The pointer resting at the window's top edge long enough to show it
    const rest = () => {
      move(1);
      wait(SITE_NAV_DWELL_MS);
    };
    const moveOver = () => act(() => {
      nav().querySelector("a, button").dispatchEvent(
        new MouseEvent("mousemove", { clientY: 30, bubbles: true }),
      );
    });
    // The pointer leaving the window (no element to go to) at clientY
    const leave = (clientY) => act(() => {
      document.body.dispatchEvent(
        new MouseEvent("mouseout", { clientY, relatedTarget: null, bubbles: true }),
      );
    });
    const touchScroll = (y) => act(() => {
      const way = y < window.scrollY ? 1 : -1;
      window.dispatchEvent(new TouchEvent("touchstart", { touches: [{ clientY: 300 }] }));
      window.dispatchEvent(new TouchEvent("touchmove", { touches: [{ clientY: 300 + way * 40 }] }));
      window.scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });
    return { root, scrollTo, shift, wait, shown, nav, move, rest, moveOver, leave, touchScroll };
  };

  it("is hidden on load, and never shows on a scroll up, by any input", () => {
    const { scrollTo, shift, wait, shown } = setup(true);
    expect(shown()).toBe(false);
    scrollTo(2_000);
    scrollTo(1_500);
    scrollTo(300);
    expect(shown()).toBe(false);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" })));
    shift(100);
    expect(shown()).toBe(false);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" })));
    shift(0);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("is hidden within its own height of the page's top, so the top looks as on load", () => {
    const { scrollTo, wait, shown, nav, move, rest } = setup(true);
    Object.defineProperty(nav(), "offsetHeight", { configurable: true, value: 58 });
    scrollTo(800);
    rest();
    move(400);
    expect(shown()).toBe(true);
    // Up to the top: hidden at once, not after the 1.5s linger
    scrollTo(57);
    expect(shown()).toBe(false);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("any scroll down by the reader hides it at once", () => {
    const { scrollTo, shift, wait, shown, move, rest } = setup(true);
    scrollTo(400);
    rest();
    move(400);
    expect(shown()).toBe(true);
    // A pixel down, inside the 1.5s
    scrollTo(401);
    expect(shown()).toBe(false);
    rest();
    move(400);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
    expect(shown()).toBe(false);
    // The page moving by itself, once the keys' scroll is over, leaves it
    wait(1_000);
    rest();
    move(400);
    shift(600);
    expect(shown()).toBe(true);
  });

  it("does not show when the pointer only passes through the top edge (HDR1)", () => {
    const { scrollTo, wait, shown, move } = setup(true);
    scrollTo(1_000);
    // From the address bar down to the Year pill: one move at the edge,
    // the next below it
    move(1);
    move(30);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("holds while the pointer is on the title band the nav pushes down (HDR1)", () => {
    const { scrollTo, wait, shown, nav, move, rest } = setup(true);
    Object.defineProperty(nav(), "offsetHeight", { configurable: true, value: 58 });
    const band = document.querySelector(".title-row");
    if (band) Object.defineProperty(band, "offsetHeight", { configurable: true, value: 57 });
    scrollTo(1_000);
    rest();
    expect(shown()).toBe(true);
    // On the Year pill, below the nav: still shown long after
    move(80);
    wait(10_000);
    expect(shown()).toBe(true);
    move(400);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("does not show when the pointer leaves the window, even through its top edge", () => {
    const { scrollTo, shown, move, leave } = setup(true);
    scrollTo(1_000);
    move(300);
    leave(900);
    expect(shown()).toBe(false);
    // On its way between the address bar and the Year pill (HDR1)
    leave(0);
    expect(shown()).toBe(false);
    move(20);
    expect(shown()).toBe(false);
  });

  it("does not show when the pointer rests at the edge, then leaves the window (HDR1)", () => {
    const { scrollTo, wait, shown, move, leave } = setup(true);
    scrollTo(1_000);
    move(1);
    leave(0);
    wait(SITE_NAV_DWELL_MS * 2);
    expect(shown()).toBe(false);
  });

  it("on a touch-only device, shows only while the page is at its very top", () => {
    const { wait, shown, move, leave, touchScroll } = setup(true, { touchOnly: true });
    // On load, at the top
    expect(shown()).toBe(true);
    wait(10_000);
    expect(shown()).toBe(true);
    touchScroll(300);
    expect(shown()).toBe(false);
    // A scroll up, or a tap's emulated mouse events at the window's top,
    // do not bring it in
    touchScroll(20);
    move(2);
    leave(0);
    wait(5_000);
    expect(shown()).toBe(false);
    touchScroll(0);
    expect(shown()).toBe(true);
    touchScroll(1);
    expect(shown()).toBe(false);
  });

  it("shows after the pointer rests at the top 2px of the window, holds while the pointer is over it, and hides 0.75s after it leaves", () => {
    const { scrollTo, wait, shown, move, rest, moveOver } = setup(true);
    move(300);
    expect(shown()).toBe(false);
    move(1);
    wait(SITE_NAV_DWELL_MS - 1);
    expect(shown()).toBe(false);
    wait(1);
    expect(shown()).toBe(true);
    moveOver();
    wait(10_000);
    scrollTo(2_000);
    wait(10_000);
    expect(shown()).toBe(true);
    move(400);
    wait(749);
    expect(shown()).toBe(true);
    // Coming back cancels the hide
    moveOver();
    wait(5_000);
    expect(shown()).toBe(true);
    move(400);
    wait(750);
    expect(shown()).toBe(false);
    // Leaving straight after it shows still keeps the 1.5s
    rest();
    move(400);
    wait(1_499);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
  });

  it("shows when the reader tabs into it, holds while focus is in it, and hides 0.75s after focus leaves", () => {
    const { wait, shown, nav } = setup(true);
    const link = nav().querySelector("a, button");
    act(() => link.focus());
    expect(shown()).toBe(true);
    wait(10_000);
    expect(shown()).toBe(true);
    act(() => link.blur());
    wait(749);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
  });

  it("holds while one of its menus is open", () => {
    const { wait, shown, nav, move, rest, moveOver } = setup(true);
    rest();
    moveOver();
    // An open ui-kit menu puts a role="presentation" overlay in the nav
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "presentation");
    act(() => nav().appendChild(overlay));
    move(400);
    wait(10_000);
    expect(shown()).toBe(true);
    act(() => overlay.remove());
    wait(750);
    expect(shown()).toBe(false);
  });
});
