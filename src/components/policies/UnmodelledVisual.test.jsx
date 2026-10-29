import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import UnmodelledVisual, { UNMODELLED_VISUAL_KINDS } from "./UnmodelledVisual";
import UnmodelledMeasures from "./UnmodelledMeasures";
import { UNMODELLED_MEASURES } from "../../utils/unmodelledMeasures";
import { UNMODELLED_CARDS } from "../../utils/unmodelledCards";
import { UNMODELLED_VISUALS } from "../../utils/unmodelledVisuals";

const byId = Object.fromEntries(UNMODELLED_MEASURES.map((measure) => [measure.id, measure]));

/** Every number in a piece of text, commas dropped: "£12,000" is 12000, "£1 million" 1. */
const numbersIn = (text) => (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

/**
 * The figures a measure's entry gives: its words, its sources' labels and
 * its card's values (percentages as points, 0.09 as 9), and the sums its
 * visual lists in `derived`.
 */
function figuresOf(id) {
  const measure = byId[id];
  const card = UNMODELLED_CARDS[id] ?? {};
  const words = [
    measure.name,
    measure.starts,
    measure.changes,
    measure.reaches,
    measure.household,
    measure.noCosting,
    ...measure.costings.map((costing) => costing.note),
    ...(card.parameters?.rows ?? []).map((row) => row.label),
    ...Object.keys(UNMODELLED_VISUALS[id].derived ?? {}),
  ]
    .filter(Boolean)
    .join(" ");
  const values = (card.parameters?.rows ?? []).flatMap((row) =>
    row.points.flatMap(({ before, after }) => (row.unit === "percent" ? [before * 100, after * 100] : [before, after])),
  );
  return new Set([...numbersIn(words), ...values.map((value) => Math.round(value * 100) / 100)]);
}

/** A node's text, a space between each piece, so "£2" and "1 Jan" stay apart. */
function textOf(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const pieces = [];
  while (walker.nextNode()) pieces.push(walker.currentNode.textContent);
  return pieces.join(" ");
}

const renderVisual = (id) => render(<UnmodelledVisual measure={byId[id]} />);

describe("the unmodelled measures' pictures (unmodelledVisuals.js)", () => {
  it("give every measure one picture of a known kind, with a sentence for screen readers", () => {
    expect(Object.keys(UNMODELLED_VISUALS).sort()).toEqual(UNMODELLED_MEASURES.map(({ id }) => id).sort());
    for (const [id, spec] of Object.entries(UNMODELLED_VISUALS)) {
      expect(UNMODELLED_VISUAL_KINDS[spec.kind], id).toBeDefined();
      expect(spec.caption, id).toMatch(/^[A-Z]/);
      expect(spec.alt, id).toMatch(/^[A-Z].{30,}\.$/);
    }
  });

  it("use a different drawing for most measures, a shared one only where they are alike", () => {
    const kinds = new Set(Object.values(UNMODELLED_VISUALS).map(({ kind }) => kind));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
  });

  it("draw only figures the entry gives, or sums of them it names", () => {
    for (const id of Object.keys(UNMODELLED_VISUALS)) {
      const { container, unmount } = renderVisual(id);
      const figure = container.querySelector("figure");
      const allowed = figuresOf(id);
      for (const text of [textOf(figure), figure.getAttribute("aria-label")]) {
        for (const number of numbersIn(text)) expect(allowed.has(number), `${id}: ${number} in "${text}"`).toBe(true);
      }
      unmount();
    }
  });

  it("say each picture to screen readers as one image, named by its sentence, under What changes", () => {
    for (const [id, spec] of Object.entries(UNMODELLED_VISUALS)) {
      const { unmount } = renderVisual(id);
      const section = screen.getByRole("region", { name: `What changes: ${byId[id].name}` });
      expect(within(section).getByRole("img", { name: spec.alt })).toBeInTheDocument();
      expect(section).toHaveTextContent(/^What changes/);
      // An SVG is decoration inside the image: the sentence says it
      for (const svg of section.querySelectorAll("figure svg")) expect(svg.getAttribute("aria-hidden"), id).toBe("true");
      unmount();
    }
  });

  it("draws nothing for a measure with no picture", () => {
    const { container } = render(<UnmodelledVisual measure={{ id: "none", name: "None" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("each kind of picture", () => {
  it("savings tax: each rate's ladder rung, the old rate grey and 2 points in amber", () => {
    const { container } = renderVisual("savings-income-tax");
    const rows = container.querySelectorAll(".umv-bar-row");
    expect([...rows].map((row) => row.querySelector(".umv-value").textContent)).toEqual(["22% → 24%", "42% → 44%", "47% → 49%"]);
    for (const row of rows) {
      const [base, add] = row.querySelectorAll(".umv-fill");
      expect(base).toHaveClass("is-before");
      expect(add).toHaveClass("is-loss");
      expect(parseFloat(add.style.width)).toBeCloseTo((100 * 2) / 55, 5);
    }
    // The grey rates are the ones already set for 6 April 2027 (Budget
    // 2025), never in force before it
    expect(container.querySelector(".umv-key").textContent).toBe("Already set for 6 Apr 20272 points more");
  });

  it("cash ISA: £20,000 kept against the planned £12,000, the gap outlined as the cut not made", () => {
    const { container } = renderVisual("cash-isa-limit");
    const ghost = container.querySelector(".umv-ghost");
    expect(parseFloat(ghost.style.left)).toBeCloseTo((100 * 12000) / 24000, 5);
    expect(parseFloat(ghost.style.width)).toBeCloseTo((100 * 8000) / 24000, 5);
    expect(container.querySelector(".umv-ghost-text")).toHaveTextContent("cut not made");
    expect(container.querySelector(".umv-fill.is-dashed")).not.toBeNull();
  });

  it("triple lock: three rules into the highest of them, earnings growth struck through", () => {
    const { container } = renderVisual("adjusted-triple-lock");
    expect([...container.querySelectorAll(".umv-input")].map((li) => li.firstChild.textContent)).toEqual([
      "2.5%",
      "Inflation",
      "Its April 2029 value against earnings",
    ]);
    expect(container.querySelector(".umv-was")).toHaveTextContent("Was: earnings growth");
    expect(container.querySelector(".umv-result")).toHaveTextContent("The highest of the three");
  });

  it("bank surcharge, mileage and gas: lines in SVG with their labels", () => {
    const labels = (id) => {
      const { container, unmount } = renderVisual(id);
      const text = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
      const lines = container.querySelectorAll("svg .umv-line").length;
      unmount();
      return { text, lines };
    };
    expect(labels("bank-surcharge")).toEqual({ text: ["3%", "6% for 15 months", "Jan 2027", "Mar 2028"], lines: 2 });
    expect(labels("mileage-rates")).toEqual({ text: ["55p, made permanent", "35p", "was 25p", "10,000 miles"], lines: 2 });
    expect(labels("gas-standing-charges")).toEqual({ text: ["£108 standing charge", "Less gas used: bill falls", "More gas used: bill rises"], lines: 2 });
  });

  it("pubs relief: the relief as a share of the bill, 15% then 35%", () => {
    const { container } = renderVisual("pubs-business-rates-relief");
    expect([...container.querySelectorAll(".umv-fill")].map((fill) => fill.style.width)).toEqual(["15%", "35%"]);
    expect(container.querySelector(".umv-key")).toHaveTextContent("The rest of the bill is paid");
  });

  it("online marketplaces: the seller pays HMRC, then the marketplace collects and pays", () => {
    const { container } = renderVisual("online-marketplace-liability");
    expect([...container.querySelectorAll(".umv-steps")].map((lane) => lane.textContent)).toEqual([
      "SellerHMRC",
      "SellerOnline marketplaceHMRC",
    ]);
  });

  it("Your First Home and the First Time Buyer ISA: one bar in parts, the rest worked out", () => {
    const parts = (id) => {
      const { container, unmount } = renderVisual(id);
      const widths = [...container.querySelectorAll(".umv-part")].map((part) => part.style.width);
      unmount();
      return widths;
    };
    expect(parts("your-first-home")).toEqual(["2.5%", "20%", "77.5%"]);
    // A 25% bonus on the savings is a fifth of the whole
    expect(parts("first-time-buyer-isa")).toEqual(["80%", "20%"]);
  });

  it("BADR: 18% to £1 million, then 18% to £500,000 and up to 24% above", () => {
    const { container } = renderVisual("business-asset-disposal-relief");
    const rows = [...container.querySelectorAll(".umv-band-track")].map((track) =>
      [...track.children].map((band) => `${band.textContent} ${band.style.width}`),
    );
    expect(rows).toEqual([["18% 100%"], ["18% 50%", "Up to 24% 50%"]]);
    expect(container.querySelector(".umv-ticks")).toHaveTextContent("£500,000£1 million");
  });

  it("NLW, UC, Machine Games Duty and company car tax: bars from zero to the stated values", () => {
    const values = (id) => {
      const { container, unmount } = renderVisual(id);
      const text = [...container.querySelectorAll(".umv-value")].map((v) => v.textContent);
      unmount();
      return text;
    };
    expect(values("national-living-wage")).toEqual(["£12.71", "£13.21 (+3.9%)"]);
    expect(values("universal-credit-surplus-earnings")).toEqual(["£300", "£2,500"]);
    expect(values("machine-games-duty")).toEqual(["20%", "25%"]);
    expect(values("company-car-tax")).toEqual(["9% → 10%", "19% → 20%"]);
  });

  it("parental pay: two weeks after a birth, each up to £194", () => {
    const { container } = renderVisual("parental-allowance");
    expect([...container.querySelectorAll(".umv-week")].map((w) => w.textContent)).toEqual(["First weekUp to £194", "Second weekUp to £194"]);
  });
});

describe("on the cards (UnmodelledMeasures.jsx)", () => {
  it("puts each card's picture under What changes, with no values' tiles beside it", () => {
    render(<UnmodelledMeasures />);
    fireEvent.click(screen.getByRole("button", { name: /Budget policies we do not model/ }));
    for (const measure of UNMODELLED_MEASURES) {
      const card = document.getElementById(`unmodelled-${measure.id}`);
      const spec = card.querySelector(".policy-card-spec");
      expect(within(spec).getByRole("img", { name: UNMODELLED_VISUALS[measure.id].alt }), measure.id).toBeInTheDocument();
      expect(spec.querySelectorAll(".pchg").length, measure.id).toBe(1);
      expect(spec.querySelector(".pchg-table, .pchg-plot, .pchg-more"), measure.id).toBeNull();
    }
  });
});
