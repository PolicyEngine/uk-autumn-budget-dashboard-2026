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

  it("stays sticky, hides above the window when scrolled down, and the bars sit under it", () => {
    const sheet = css();
    expect(sheet).not.toMatch(/position:\s*relative\s*!important/);
    expect(sheet).toContain(`:root[data-site-nav-hidden] ${SELECTOR}`);
    expect(sheet).toMatch(/top:\s*calc\(-1 \* var\(--site-nav-height, 58px\)\) !important/);
    expect(sheet).toMatch(/\.title-row \{\s*position: sticky;\s*top: var\(--nav-offset\);/);
    expect(sheet).toMatch(/\.view-tabs-bar \{\s*position: sticky;\s*top: calc\(var\(--nav-offset\) \+ var\(--title-row-height\)\);/);
    expect(sheet).toContain("--sticky-offset: calc(var(--nav-offset) + var(--title-row-height) + var(--view-tabs-height) + var(--sub-band-height));");
    expect(sheet).toMatch(/transition: top var\(--motion-slide\) var\(--ease-out\)/);
    expect(sheet).not.toContain("data-band-hidden");
  });
});

describe("hiding the site nav on scroll", () => {
  it("hides it scrolling down, shows it scrolling up or at the top, and ignores scrolls under 6px", () => {
    vi.stubGlobal("fetch", async () => new Promise(() => {}));
    // Runs the frame at once; 0 so the next scroll asks for another
    vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 0; });
    window.history.replaceState({}, "", "/");
    render(<App />);
    const root = document.documentElement;
    const scrollTo = (y) => act(() => {
      window.scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });
    const hidden = () => root.hasAttribute("data-site-nav-hidden");
    expect(hidden()).toBe(false);
    scrollTo(4);
    expect(hidden()).toBe(false);
    scrollTo(400);
    expect(hidden()).toBe(true);
    scrollTo(396);
    expect(hidden()).toBe(true);
    scrollTo(300);
    expect(hidden()).toBe(false);
    scrollTo(600);
    expect(hidden()).toBe(true);
    scrollTo(0);
    expect(hidden()).toBe(false);
    cleanup();
    expect(hidden()).toBe(false);
  });
});
