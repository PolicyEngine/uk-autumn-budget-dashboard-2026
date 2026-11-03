import { render } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import ViewTabs, { scrollToShow } from "./ViewTabs";

// A tab's place in a row and the row's scroll, in whole pixels
const geometry = fc.record({
  left: fc.integer({ min: 0, max: 2000 }),
  width: fc.integer({ min: 1, max: 400 }),
  scrollLeft: fc.integer({ min: 0, max: 2000 }),
  clientWidth: fc.integer({ min: 1, max: 1600 }),
});
// ...where the row has room for the tab and 24px on each side
const fits = geometry.filter(({ width, clientWidth }) => width + 48 <= clientWidth);

describe("where a scrolling tab row scrolls to keep the chosen tab in sight (scrollToShow)", () => {
  it("never scrolls before the row's start", () => {
    fc.assert(
      fc.property(geometry, (place) => {
        expect(scrollToShow(place)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("leaves the row where it is while the tab has 24px of it to spare on each side", () => {
    fc.assert(
      fc.property(fits, (place) => {
        fc.pre(place.left - 24 >= place.scrollLeft && place.left + place.width + 24 <= place.scrollLeft + place.clientWidth);
        expect(scrollToShow(place)).toBe(place.scrollLeft);
      }),
    );
  });

  it("puts a tab with room 24px clear of both edges, or at the row's start, and then leaves it there", () => {
    fc.assert(
      fc.property(fits, (place) => {
        const next = scrollToShow(place);
        expect(place.left + place.width + 24).toBeLessThanOrEqual(next + place.clientWidth);
        expect(next === 0 || place.left - next >= 24).toBe(true);
        expect(scrollToShow({ ...place, scrollLeft: next })).toBe(next);
      }),
    );
  });

  it("brings a tab past either edge 24px in from it", () => {
    expect(scrollToShow({ left: 474, width: 150, scrollLeft: 0, clientWidth: 470 })).toBe(178);
    expect(scrollToShow({ left: 300, width: 150, scrollLeft: 400, clientWidth: 470 })).toBe(276);
    expect(scrollToShow({ left: 10, width: 150, scrollLeft: 400, clientWidth: 470 })).toBe(0);
  });

  // The loading placeholder copies this (ViewSkeleton.jsx, is-at-start)
  it("never scrolls for the first tab, even one wider than the row", () => {
    fc.assert(
      fc.property(fc.nat(600), fc.integer({ min: 1, max: 600 }), fc.nat(800), (width, clientWidth, scrollLeft) => {
        expect(scrollToShow({ left: 0, width, scrollLeft, clientWidth })).toBe(0);
      }),
    );
    expect(scrollToShow({ left: 0, width: 195, scrollLeft: 0, clientWidth: 194 })).toBe(0);
  });
});

describe("the view tab bar's scrolling row", () => {
  afterEach(() => vi.restoreAllMocks());

  const TABS = [
    { value: "dashboard", label: "Population impact" },
    { value: "household", label: "Household calculator" },
    { value: "outlook", label: "Current law" },
    { value: "policies", label: "Policies" },
    { value: "methodology", label: "Methodology" },
  ];

  // jsdom lays nothing out, so the row and its tabs get a geometry: About
  // leads the row (117px into the bar), five 150px tabs 8px apart in a
  // row 470px wide. The row is its tabs' offset parent, so a tab's
  // offsetLeft is already its place in the row.
  const layOut = () => {
    const isRow = (node) => node.classList?.contains("view-tabs");
    const tabIndex = (node) => (node.getAttribute?.("role") === "tab" ? [...node.parentElement.querySelectorAll('[role="tab"]')].indexOf(node) : -1);
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function () {
      if (isRow(this)) return 117;
      const index = tabIndex(this);
      return index >= 0 ? index * 158 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () {
      return tabIndex(this) >= 0 ? 150 : 0;
    });
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function () {
      return isRow(this) ? 470 : 0;
    });
  };

  it("scrolls by the chosen tab's place in the row, whatever leads the row", () => {
    layOut();
    const { container } = render(
      <ViewTabs tabs={TABS} value="policies" onChange={() => {}} tabId={(value) => `tab-${value}`} panelId={(value) => `panel-${value}`} leading={<span>About</span>} />,
    );
    const row = container.querySelector(".view-tabs");
    // Policies runs from 474px to 624px in the row: it ends 24px before
    // the row's end once the row has scrolled 178px (not 61px, as it did
    // when About's place was taken off the tab's a second time)
    expect(row.scrollLeft).toBe(178);
    expect(row.clientWidth - (474 + 150 - row.scrollLeft)).toBe(24);
  });

  it("leaves a row alone whose chosen tab is in sight", () => {
    layOut();
    const { container } = render(
      <ViewTabs tabs={TABS} value="household" onChange={() => {}} tabId={(value) => `tab-${value}`} panelId={(value) => `panel-${value}`} leading={<span>About</span>} />,
    );
    expect(container.querySelector(".view-tabs").scrollLeft).toBe(0);
  });

  // Hidden on the landing page, the bar has no geometry; once a view opens
  // it shows, and the sub-tab row's --view-tab-x must come from the row as
  // it now sits (pulled a tab's padding into the margin, globals.css), not
  // from the hidden bar. Nothing leads the row, so only the bar showing
  // can measure it again.
  it("measures the chosen tab's place again once the bar shows", () => {
    layOut();
    let rowLeft = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      const left = this.classList?.contains("view-tabs") ? rowLeft : 0;
      return { left, right: left, top: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() {} };
    });
    const props = { tabs: TABS, value: "dashboard", onChange: () => {}, tabId: (value) => `tab-${value}`, panelId: (value) => `panel-${value}` };
    const { rerender } = render(<ViewTabs {...props} hidden />);
    expect(document.documentElement.style.getPropertyValue("--view-tab-x")).toBe("0px");
    rowLeft = -12;
    rerender(<ViewTabs {...props} hidden={false} />);
    expect(document.documentElement.style.getPropertyValue("--view-tab-x")).toBe("-12px");
  });
});
