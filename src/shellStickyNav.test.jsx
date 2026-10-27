import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import App, { preloadAllViews } from "./App";
import { resetPageScroll, scrollPageTo } from "./utils/pageScroll";

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
    expect(sheet).not.toMatch(/position:\s*relative\s*!important/);
    expect(sheet).toMatch(/position: fixed !important;\s*top: 0 !important;/);
    expect(sheet).toContain(`:root:not([data-site-nav-shown]) ${SELECTOR} {\n  transform: translateY(-100%);`);
    expect(sheet).toMatch(/:root \{\s*--nav-offset: 0px;\s*\}/);
    // Shown, the nav overlays the band: it never moves the sticky stack
    expect(sheet).not.toMatch(/:root\[data-site-nav-shown\] \{\s*--nav-offset/);
    expect(sheet).toMatch(/:root\[data-site-nav-shown\] \.min-h-screen\.flex\.flex-col > div:first-child\[style\*="sticky"\] \{\s*box-shadow/);
    expect(sheet).toMatch(/\.title-row \{\s*position: sticky;\s*top: var\(--nav-offset\);/);
    expect(sheet).toMatch(/\.view-tabs-bar \{\s*position: sticky;\s*top: calc\(var\(--nav-offset\) \+ var\(--title-row-height\)\);/);
    expect(sheet).toContain("--sticky-offset: calc(var(--nav-offset) + var(--title-row-height) + var(--view-tabs-height) + var(--sub-band-height));");
    expect(sheet).toMatch(/transition: transform var\(--motion-slide\) var\(--ease-out\)/);
    expect(sheet).not.toContain("data-band-hidden");
    expect(sheet).not.toContain("data-site-nav-hidden");
  });
});

describe("showing the site nav", () => {
  afterEach(() => vi.useRealTimers());

  const setup = (inShell = false) => {
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
    const moveOver = () => act(() => {
      nav().querySelector("a, button").dispatchEvent(
        new MouseEvent("mousemove", { clientY: 30, bubbles: true }),
      );
    });
    return { root, scrollTo, shift, wait, shown, nav, move, moveOver };
  };

  it("is hidden on load, and shows only once the reader has scrolled up 24px in one run", () => {
    const { scrollTo, wait, shown } = setup();
    expect(shown()).toBe(false);
    scrollTo(4);
    expect(shown()).toBe(false);
    scrollTo(400);
    expect(shown()).toBe(false);
    scrollTo(396);
    scrollTo(380);
    expect(shown()).toBe(false);
    // A scroll down starts the run again
    scrollTo(390);
    scrollTo(370);
    expect(shown()).toBe(false);
    scrollTo(366);
    expect(shown()).toBe(true);
    cleanup();
    expect(shown()).toBe(false);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("is always hidden within its own height of the page's top, so the top looks as on load", () => {
    const { scrollTo, wait, shown, nav } = setup(true);
    Object.defineProperty(nav(), "offsetHeight", { configurable: true, value: 58 });
    scrollTo(800);
    scrollTo(300);
    expect(shown()).toBe(true);
    // Back at the top: hidden at once, not after the 1.5s linger
    scrollTo(0);
    expect(shown()).toBe(false);
    scrollTo(57);
    expect(shown()).toBe(false);
    wait(10_000);
    expect(shown()).toBe(false);
  });

  it("does not show for the page's own scroll up (utils/pageScroll), only the reader's", () => {
    const { scrollTo, shown } = setup();
    scrollTo(1_000);
    act(() => {
      window.scrollTo = () => {};
      scrollPageTo(200);
    });
    scrollTo(600);
    scrollTo(200);
    expect(shown()).toBe(false);
    resetPageScroll();
    scrollTo(100);
    expect(shown()).toBe(true);
  });

  it("stays 1.5s after the scroll up, and any scroll down by the reader hides it at once", () => {
    const { scrollTo, shift, wait, shown } = setup();
    scrollTo(400);
    scrollTo(300);
    expect(shown()).toBe(true);
    wait(1_499);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
    scrollTo(200);
    expect(shown()).toBe(true);
    // A pixel down, inside the 1.5s
    scrollTo(201);
    expect(shown()).toBe(false);
    // Keys count as the reader's scroll too
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" })));
    shift(100);
    expect(shown()).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
    expect(shown()).toBe(false);
  });

  it("never shows when the page moves up by itself while the reader scrolls down", () => {
    const { scrollTo, shift, wait, shown } = setup();
    // The tab rows going compact as they stick shrink the page above the
    // window, and scroll anchoring moves scrollY up a few px each time
    scrollTo(120);
    shift(113);
    shift(111);
    scrollTo(230);
    for (let y = 228; y >= 220; y -= 2) shift(y);
    // A chart loading above the window shrinking a long way
    wait(1_000);
    shift(400);
    shift(150);
    expect(shown()).toBe(false);
    // Trackpad jitter: tiny moves up inside a scroll down
    let y = 400;
    for (const d of [3, 8, 14, 20, 16, -2, 10, 6, 4, -1, 2, 1, -3, 12]) {
      y += d;
      scrollTo(y);
      expect(shown()).toBe(false);
    }
  });

  it("shows at the top 8px of the window, holds while the pointer is over it, and hides 0.75s after it leaves", () => {
    const { scrollTo, wait, shown, move, moveOver } = setup(true);
    move(300);
    expect(shown()).toBe(false);
    move(6);
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
    move(6);
    move(400);
    wait(1_499);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
  });

  it("holds while focus is in it, and hides 0.75s after focus leaves", () => {
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
    const { wait, shown, nav, move, moveOver } = setup(true);
    move(6);
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
