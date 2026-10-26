import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import CountUpText from "./CountUpText";

const stubMotion = (reduce) =>
  vi.stubGlobal("matchMedia", (query) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CountUpText", () => {
  it("shows the first figure as it is (no count on page load)", () => {
    stubMotion(false);
    const { container } = render(<CountUpText text="£43.1k" />);
    expect(container.textContent).toBe("£43.1k");
    expect(container.querySelector(".count-up")).toBeNull();
  });

  it("counts a changed figure from the old value, keeping its unit, and reads the final figure", () => {
    stubMotion(false);
    let frame = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => { frame = cb; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { container, rerender } = render(<CountUpText text="≈4,000 fewer" />);
    rerender(<CountUpText text="≈8,000 fewer" />);
    act(() => frame(0));
    act(() => frame(100));
    const shown = container.querySelector('.count-up [aria-hidden="true"]').textContent;
    expect(shown).toMatch(/^≈\d{1,3}(,\d{3})? fewer$/);
    expect(shown).not.toBe("≈8,000 fewer");
    expect(container.querySelector(".visually-hidden").textContent).toBe("≈8,000 fewer");
    act(() => frame(1000));
    expect(container.textContent).toBe("≈8,000 fewer");
  });

  it("jumps with prefers-reduced-motion", () => {
    stubMotion(true);
    const { container, rerender } = render(<CountUpText text="+0.2pp" />);
    rerender(<CountUpText text="+0.6pp" />);
    expect(container.textContent).toBe("+0.6pp");
  });

  it("jumps when the unit changes", () => {
    stubMotion(false);
    const { container, rerender } = render(<CountUpText text="£12" />);
    rerender(<CountUpText text="12%" />);
    expect(container.textContent).toBe("12%");
  });
});
