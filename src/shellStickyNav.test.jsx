import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import App from "./App";

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
    expect(sheet).toMatch(/:root\[data-site-nav-shown\] \{\s*--nav-offset: var\(--site-nav-height, 0px\);/);
    expect(sheet).toMatch(/\.title-row \{\s*position: sticky;\s*top: var\(--nav-offset\);/);
    expect(sheet).toMatch(/\.view-tabs-bar \{\s*position: sticky;\s*top: calc\(var\(--nav-offset\) \+ var\(--title-row-height\)\);/);
    expect(sheet).toContain("--sticky-offset: calc(var(--nav-offset) + var(--title-row-height) + var(--view-tabs-height) + var(--sub-band-height));");
    expect(sheet).toMatch(/transition: transform var\(--motion-slide\) var\(--ease-out\)/);
    expect(sheet).not.toContain("data-band-hidden");
    expect(sheet).not.toContain("data-site-nav-hidden");
  });
});

describe("showing the site nav", () => {
  const setup = (inShell = false) => {
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
    const shown = () => root.hasAttribute("data-site-nav-shown");
    return { root, scrollTo, shown };
  };

  it("is hidden on load, shows scrolling up, hides scrolling down, and ignores scrolls under 6px", () => {
    const { scrollTo, shown } = setup();
    expect(shown()).toBe(false);
    scrollTo(4);
    expect(shown()).toBe(false);
    scrollTo(400);
    expect(shown()).toBe(false);
    scrollTo(396);
    expect(shown()).toBe(false);
    scrollTo(300);
    expect(shown()).toBe(true);
    scrollTo(304);
    expect(shown()).toBe(true);
    scrollTo(600);
    expect(shown()).toBe(false);
    scrollTo(0);
    expect(shown()).toBe(true);
    scrollTo(200);
    expect(shown()).toBe(false);
    cleanup();
    expect(shown()).toBe(false);
  });

  it("shows while the pointer is at the top 8px of the window, and when focus enters it", () => {
    const { shown } = setup(true);
    const move = (clientY) => act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY }));
    });
    move(300);
    expect(shown()).toBe(false);
    move(6);
    expect(shown()).toBe(true);
    move(400);
    expect(shown()).toBe(false);
    const link = document.querySelector(SELECTOR).querySelector("a, button");
    act(() => link.focus());
    expect(shown()).toBe(true);
    act(() => link.blur());
    expect(shown()).toBe(false);
  });
});
