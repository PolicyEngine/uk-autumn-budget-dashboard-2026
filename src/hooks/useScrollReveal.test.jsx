import { describe, expect, it, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import useScrollReveal from "./useScrollReveal";

function Page() {
  const ref = useRef(null);
  useScrollReveal(ref);
  return (
    <div ref={ref}>
      <div className="tab-panel">
        <div className="section-heading">Heading</div>
        <div className="charts-grid">
          <div>Card one</div>
          <div>Card two</div>
        </div>
      </div>
    </div>
  );
}

describe("useScrollReveal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hides nothing without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<Page />);
    expect(container.querySelectorAll(".reveal")).toHaveLength(0);
  });

  it("staggers cards side by side and reveals each once in view", () => {
    const observed = [];
    let callback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb) {
          callback = cb;
        }
        observe(element) {
          observed.push(element);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { container } = render(<Page />);
    // jsdom lays nothing out, so every element counts as off screen
    const cards = container.querySelectorAll(".charts-grid > div");
    expect(cards[1].classList.contains("reveal")).toBe(true);
    expect(cards[1].style.getPropertyValue("--reveal-delay")).toBe("70ms");
    callback([{ isIntersecting: true, target: cards[1] }]);
    expect(cards[1].classList.contains("is-revealed")).toBe(true);
    expect(observed.length).toBe(3);
  });
});
