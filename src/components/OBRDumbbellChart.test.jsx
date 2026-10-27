import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import OBRDumbbellChart, {
  GAP_COLOUR,
  OBR_COLOUR,
  PE_COLOUR,
  formatBn,
  formatDifference,
  obrValue,
  pctOfOfficial,
} from "./OBRDumbbellChart";

// comparisonRows() output, largest official costing first
const rows = [
  { id: "threshold_freeze", name: "Threshold freeze", pe: 7.77, obr: 7.6, obrStatic: 7.4, obrBehavioural: 7.6 },
  { id: "two_child_limit", name: "2 child limit repeal", pe: -3.56, obr: -3.0, obrStatic: -2.7, obrBehavioural: -3.0 },
  { id: "salary_sacrifice_cap", name: "Salary sacrifice cap", pe: 2.78, obr: null, obrStatic: null, obrBehavioural: null },
];

const chart = (props = {}) => render(<OBRDumbbellChart rows={rows} yearLabel="2029-30" obrKind="post-behavioural" {...props} />);
const rowEl = (container, id) => container.querySelector(`[data-policy="${id}"]`);
const labels = (container, id) => [...rowEl(container, id).querySelectorAll(".obr-dumbbell-value")].map((n) => n.textContent);

describe("OBRDumbbellChart", () => {
  it("keeps the rows in the order given", () => {
    const { container } = chart();
    expect([...container.querySelectorAll(".obr-dumbbell-name")].map((n) => n.textContent)).toEqual([
      "Threshold freeze",
      "2 child limit repeal",
      "Salary sacrifice cap",
    ]);
  });

  it("says 'not in the official costings' for a missing official figure instead of plotting zero", () => {
    const { container } = chart();
    const row = rowEl(container, "salary_sacrifice_cap");
    expect(row.querySelector(".obr-dumbbell-missing").textContent).toBe("Not in the official costings");
    expect(row.querySelector(".obr-dumbbell-dot.obr")).toBeNull();
    expect(row.querySelector(".obr-dumbbell-dot.pe")).not.toBeNull();
    expect(row.querySelector(".obr-dumbbell-difference").textContent).toBe("—");
  });

  it("gives the difference, PolicyEngine minus official, in a column at the right", () => {
    const { container } = chart();
    expect(container.querySelector(".obr-dumbbell-column-head").textContent).toBe("Difference");
    expect(rowEl(container, "two_child_limit").querySelector(".obr-dumbbell-difference").textContent).toBe("−£0.6bn");
    expect(rowEl(container, "threshold_freeze").querySelector(".obr-dumbbell-difference").textContent).toBe("+£0.2bn");
  });

  it("draws the connecting line in one neutral colour, with no difference bands", () => {
    const { container } = chart();
    const gaps = [...container.querySelectorAll(".obr-dumbbell-gap")];
    expect(gaps.length).toBe(2);
    gaps.forEach((gap) => {
      expect(gap.getAttribute("stroke")).toBe(GAP_COLOUR);
      expect(gap.dataset.band).toBeUndefined();
    });
    expect(container).not.toHaveTextContent("under £0.5bn");
  });

  it("shows 'Not yet published' when no row has a figure, never zeros", () => {
    const { container, getByText } = chart({ rows: [{ id: "a", name: "A", pe: null, obr: null, obrStatic: null, obrBehavioural: null }] });
    expect(getByText("Not yet published")).toBeInTheDocument();
    expect(container.querySelector("svg circle")).toBeNull();
  });

  it("labels estimates that round equal once, as 'same', a dot inside a ring", () => {
    const { container } = chart({ rows: [{ id: "rail", name: "Rail fares freeze", pe: -0.2, obr: -0.2, obrStatic: -0.2, obrBehavioural: -0.2 }] });
    const row = rowEl(container, "rail");
    const pe = row.querySelector(".obr-dumbbell-dot.pe");
    const obr = row.querySelector(".obr-dumbbell-dot.obr");
    expect(pe.getAttribute("fill")).toBe(PE_COLOUR);
    expect(obr.getAttribute("fill")).toBe("none");
    expect(obr.getAttribute("stroke")).toBe(OBR_COLOUR);
    expect(Number(obr.getAttribute("r"))).toBeGreaterThan(Number(pe.getAttribute("r")));
    expect(pe.getAttribute("cx")).toBe(obr.getAttribute("cx"));
    const circles = [...row.querySelectorAll("circle")];
    expect(circles.indexOf(obr)).toBeGreaterThan(circles.indexOf(pe));
    expect(labels(container, "rail")).toEqual(["−£0.2bn, same"]);
    expect(row.querySelector(".obr-dumbbell-difference").textContent).toBe("£0.0bn");
  });

  it("labels different estimates separately", () => {
    const { container } = chart();
    expect(labels(container, "threshold_freeze").sort()).toEqual(["£7.6bn", "£7.8bn"]);
  });

  it("keys PolicyEngine and the official costing by name, never 'OBR'", () => {
    const { container } = chart();
    const legend = container.querySelector('[aria-label="Legend"]');
    expect(legend.textContent).toBe("PolicyEngine (static)Official costing (post-behavioural)");
    expect(legend.querySelector(".obr-dumbbell-key-ring")).not.toBeNull();
  });

  it("on the % scale puts every official costing at 100% and skips one too small for a %", () => {
    const small = { id: "tiny", name: "Tiny", pe: 0.03, obr: 0.0, obrStatic: 0.0, obrBehavioural: 0.0 };
    const { container } = chart({ rows: [...rows, small], scale: "pct" });
    const rings = [...container.querySelectorAll(".obr-dumbbell-dot.obr")].map((ring) => ring.getAttribute("cx"));
    expect(new Set(rings).size).toBe(1);
    expect(rowEl(container, "tiny").querySelector(".obr-dumbbell-missing").textContent).toBe("Official costing £0.0bn: no % to show");
    expect(rowEl(container, "tiny").querySelector("circle")).toBeNull();
    expect(container).toHaveTextContent("100%");
  });
});

describe("helpers", () => {
  it("formats £bn with a true minus and no negative zero", () => {
    expect(formatBn(-3.12)).toBe("−£3.1bn");
    expect(formatBn(12.35)).toBe("£12.4bn");
    expect(formatBn(-0.01)).toBe("£0.0bn");
    expect(formatBn(NaN)).toBe("");
  });

  it("signs a difference", () => {
    expect(formatDifference(0.31)).toBe("+£0.3bn");
    expect(formatDifference(-0.31)).toBe("−£0.3bn");
    expect(formatDifference(0.01)).toBe("£0.0bn");
    expect(formatDifference(null)).toBe("—");
  });

  it("gives a % of the official costing only where it has a base", () => {
    expect(pctOfOfficial(1.1, 1)).toBeCloseTo(110);
    expect(pctOfOfficial(1, 0)).toBeNull();
    expect(pctOfOfficial(null, 1)).toBeNull();
  });

  it("falls back to the other official figure when one is missing", () => {
    expect(obrValue({ obr_static: 1, obr_behavioural: NaN }, true)).toBe(1);
    expect(obrValue({ obr_static: NaN, obr_behavioural: NaN }, true)).toBeNull();
  });
});
