import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OBRDumbbellChart, {
  OBR_COLOUR,
  PE_COLOUR,
  formatBn,
  bandFor,
  obrValue,
} from "./OBRDumbbellChart";

// The comparison table's grouped data, in its order
const policies = [
  [
    "two_child_limit",
    {
      name: "2 child limit repeal",
      years: {
        2029: { policyengine: -3.56, obr_static: -2.7, obr_behavioural: -3.0 },
      },
    },
  ],
  [
    "threshold_freeze_extension",
    {
      name: "Threshold freeze extension",
      years: {
        2027: { policyengine: 0, obr_static: 0, obr_behavioural: 0 },
        2029: { policyengine: 7.77, obr_static: 7.4, obr_behavioural: 7.6 },
      },
    },
  ],
  [
    "salary_sacrifice_cap",
    {
      name: "Salary sacrifice cap",
      years: {
        2029: { policyengine: 2.78, obr_static: NaN, obr_behavioural: NaN },
      },
    },
  ],
];

const rowNames = (container) =>
  Array.from(container.querySelectorAll(".obr-dumbbell-name")).map(
    (n) => n.textContent,
  );

describe("OBRDumbbellChart", () => {
  it("titles the chart with the selected year and keeps the table's row order", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    expect(
      screen.getByRole("heading", {
        name: "PolicyEngine and OBR estimates, 2029-30",
      }),
    ).toBeInTheDocument();
    expect(rowNames(container)).toEqual([
      "2 child limit repeal",
      "Threshold freeze extension",
      "Salary sacrifice cap",
    ]);
  });

  it("says 'not yet published' for a missing OBR figure instead of plotting zero", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    const row = container.querySelector('[data-policy="salary_sacrifice_cap"]');
    expect(row.querySelector(".obr-dumbbell-missing").textContent).toBe(
      "OBR not yet published",
    );
    expect(row.querySelector(".obr-dumbbell-dot.obr")).toBeNull();
    expect(row.querySelector(".obr-dumbbell-dot.pe")).not.toBeNull();
  });

  it("moves the OBR dot when the static / post-behavioural switch changes", () => {
    const { container, rerender } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    const obrText = () =>
      Array.from(
        container.querySelectorAll(
          '[data-policy="two_child_limit"] .obr-dumbbell-value',
        ),
      ).map((n) => n.textContent);
    expect(obrText()).toContain("−£3.0bn");
    rerender(
      <OBRDumbbellChart
        policies={policies}
        year={2029}
        showBehavioural={false}
      />,
    );
    expect(obrText()).toContain("−£2.7bn");
  });

  it("colours the connecting line by the difference band", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    const band = (id) =>
      container.querySelector(`[data-policy="${id}"] .obr-dumbbell-gap`).dataset
        .band;
    expect(band("two_child_limit")).toBe("medium");
    expect(band("threshold_freeze_extension")).toBe("small");
  });

  it("shows 'Not yet published' for a year with no data, never zeros", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2030} showBehavioural />,
    );
    expect(screen.getByText("Not yet published")).toBeInTheDocument();
    expect(container.querySelector("svg circle")).toBeNull();
  });

  it("plots a genuine zero as zero", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2027} showBehavioural />,
    );
    const row = container.querySelector(
      '[data-policy="threshold_freeze_extension"]',
    );
    expect(row.querySelectorAll(".obr-dumbbell-dot")).toHaveLength(2);
    expect(row.querySelector(".obr-dumbbell-value").textContent).toBe(
      "£0.0bn (both)",
    );
  });

  it("keeps both marks visible when the estimates are equal: a dot inside a ring", () => {
    const equal = [
      [
        "rail_fares_freeze",
        {
          name: "Rail fares freeze",
          years: {
            2029: { policyengine: -0.2, obr_static: -0.2, obr_behavioural: -0.2 },
          },
        },
      ],
    ];
    const { container } = render(
      <OBRDumbbellChart policies={equal} year={2029} showBehavioural />,
    );
    const row = container.querySelector('[data-policy="rail_fares_freeze"]');
    const pe = row.querySelector(".obr-dumbbell-dot.pe");
    const obr = row.querySelector(".obr-dumbbell-dot.obr");
    // A solid teal dot, and a hollow grey ring drawn over it, larger
    expect(pe.getAttribute("fill")).toBe(PE_COLOUR);
    expect(obr.getAttribute("fill")).toBe("none");
    expect(obr.getAttribute("stroke")).toBe(OBR_COLOUR);
    expect(Number(obr.getAttribute("r"))).toBeGreaterThan(
      Number(pe.getAttribute("r")),
    );
    expect(pe.getAttribute("cx")).toBe(obr.getAttribute("cx"));
    const circles = [...row.querySelectorAll("circle")];
    expect(circles.indexOf(obr)).toBeGreaterThan(circles.indexOf(pe));
    // One label for both values, not two on top of each other
    const labels = [...row.querySelectorAll(".obr-dumbbell-value")].map(
      (n) => n.textContent,
    );
    expect(labels).toEqual(["−£0.2bn (both)"]);
  });

  it("labels close but different estimates separately", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    const labels = [
      ...container.querySelectorAll(
        '[data-policy="threshold_freeze_extension"] .obr-dumbbell-value',
      ),
    ].map((n) => n.textContent);
    expect(labels.sort()).toEqual(["£7.6bn", "£7.8bn"]);
  });

  it("keys the OBR as a ring, as the chart draws it", () => {
    const { container } = render(
      <OBRDumbbellChart policies={policies} year={2029} showBehavioural />,
    );
    const legend = container.querySelector('[aria-label="Legend"]');
    expect(legend.querySelector(".obr-dumbbell-key-ring")).not.toBeNull();
    expect(legend.querySelectorAll(".obr-dumbbell-key-dot")).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("formats £bn with a true minus and no negative zero", () => {
    expect(formatBn(-3.12)).toBe("−£3.1bn");
    expect(formatBn(12.35)).toBe("£12.4bn");
    expect(formatBn(-0.01)).toBe("£0.0bn");
    expect(formatBn(NaN)).toBe("");
  });

  it("uses the table's bands", () => {
    expect(bandFor(1, 1.4).key).toBe("small");
    expect(bandFor(1, 2.9).key).toBe("medium");
    expect(bandFor(1, 3.1).key).toBe("large");
    expect(bandFor(1, NaN)).toBeNull();
  });

  it("falls back to the other OBR figure when one is missing", () => {
    expect(obrValue({ obr_static: 1, obr_behavioural: NaN }, true)).toBe(1);
    expect(
      obrValue({ obr_static: NaN, obr_behavioural: NaN }, true),
    ).toBeNull();
  });
});
