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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("fetch", async () => new Promise(() => {}));
    // Runs the frame at once; 0 so the next scroll asks for another
    vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 0; });
    window.history.replaceState({}, "", "/");
    window.scrollY = 0;
    render(inShell ? (
      <PolicyEngineShell country="uk" showFooter={false}><App /></PolicyEngineShell>
    ) : <App />);
    const root = document.documentElement;
    const scrollTo = (y) => act(() => {
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
    return { root, scrollTo, wait, shown, nav, move, moveOver };
  };

  it("is hidden on load, shows scrolling up, and ignores scrolls under 6px", () => {
    const { scrollTo, wait, shown } = setup();
    expect(shown()).toBe(false);
    scrollTo(4);
    expect(shown()).toBe(false);
    scrollTo(400);
    expect(shown()).toBe(false);
    scrollTo(396);
    expect(shown()).toBe(false);
    scrollTo(300);
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
    // Back at the top: hidden at once, not after the 3s linger
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

  it("stays 3s whatever the scroll, then hides only on a run down of over 120px", () => {
    const { scrollTo, wait, shown } = setup();
    scrollTo(400);
    scrollTo(300);
    expect(shown()).toBe(true);
    // A big scroll down inside the 3s waits for the 3s
    scrollTo(600);
    wait(2_999);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
    scrollTo(500);
    expect(shown()).toBe(true);
    wait(3_000);
    // Small scrolls down after the 3s keep it: 60px, then up 4px, then 100px
    scrollTo(560);
    expect(shown()).toBe(true);
    scrollTo(556);
    scrollTo(656);
    wait(0);
    expect(shown()).toBe(true);
    // ...until the run down passes 120px
    scrollTo(680);
    wait(0);
    expect(shown()).toBe(false);
    scrollTo(0);
    expect(shown()).toBe(true);
  });

  it("shows at the top 8px of the window, holds while the pointer is over it, and hides 1.5s after it leaves", () => {
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
    wait(1_499);
    expect(shown()).toBe(true);
    // Coming back cancels the hide
    moveOver();
    wait(5_000);
    expect(shown()).toBe(true);
    move(400);
    wait(1_500);
    expect(shown()).toBe(false);
    // Leaving straight after it shows still keeps the 3s
    move(6);
    move(400);
    wait(2_999);
    expect(shown()).toBe(true);
    wait(1);
    expect(shown()).toBe(false);
  });

  it("holds while focus is in it, and hides 1.5s after focus leaves", () => {
    const { wait, shown, nav } = setup(true);
    const link = nav().querySelector("a, button");
    act(() => link.focus());
    expect(shown()).toBe(true);
    wait(10_000);
    expect(shown()).toBe(true);
    act(() => link.blur());
    wait(1_499);
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
    wait(1_500);
    expect(shown()).toBe(false);
  });
});
