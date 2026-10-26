import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import SwapTransition from "./SwapTransition";

const stubMotion = (reduce) =>
  vi.stubGlobal("matchMedia", (query) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const inner = (container) => container.querySelector(".swap-transition-inner");

describe("SwapTransition", () => {
  it("does not animate on first render", () => {
    stubMotion(false);
    const { container } = render(<SwapTransition swapKey="band">A</SwapTransition>);
    expect(inner(container).classList.contains("swap-in")).toBe(false);
  });

  it("rises the new content in when the view changes, then clears its inline styles", () => {
    stubMotion(false);
    vi.useFakeTimers();
    const { container, rerender } = render(<SwapTransition swapKey="band">A</SwapTransition>);
    rerender(<SwapTransition swapKey="single">B</SwapTransition>);
    expect(inner(container).classList.contains("swap-in")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(container.firstChild.style.height).toBe("");
  });

  it("keeps the same view's content still when only its data change", () => {
    stubMotion(false);
    const { container, rerender } = render(<SwapTransition swapKey="band">2027</SwapTransition>);
    rerender(<SwapTransition swapKey="band">2028</SwapTransition>);
    expect(inner(container).classList.contains("swap-in")).toBe(false);
  });

  it("does not move with prefers-reduced-motion", () => {
    stubMotion(true);
    const { container, rerender } = render(<SwapTransition swapKey="band">A</SwapTransition>);
    rerender(<SwapTransition swapKey="single">B</SwapTransition>);
    expect(inner(container).classList.contains("swap-in")).toBe(false);
    expect(container.firstChild.style.height).toBe("");
  });

  it("passes its wrapper to a ref (a card's Download reads it)", () => {
    stubMotion(false);
    const ref = { current: null };
    render(<SwapTransition swapKey="band" ref={ref} className="chart-plot">A</SwapTransition>);
    expect(ref.current?.classList.contains("chart-plot")).toBe(true);
  });
});
