import { describe, expect, it } from "vitest";
import { CHART_COLOURS } from "../../utils/chartTheme";
import { render, screen } from "@testing-library/react";
import CombinedStats from "./CombinedStats";
import { POVERTY_FIGURES_SHOWN } from "../../utils/povertyFigures";
import FiscalSummary from "./FiscalSummary";
import UnavailableNotice from "./UnavailableNotice";
import { parseTable } from "../../utils/publication/csv";
import { CANDIDATE_PROVISIONAL_LABEL, PROVISIONAL_LABEL, parseManifest } from "../../utils/publication/manifest";
import { combinedStats, fiscalSeries } from "../../utils/publication/select";
import {
  BEYOND_DATA,
  fixtureJson,
  fixtureText,
  IN_DATA,
} from "../../test/publicationFixture";

const manifest = parseManifest(fixtureJson("manifest.json"));
// A not-computable entry's artifact is its receipt alone: it has no tables.
const tablesByKey = Object.fromEntries(
  Object.entries({ ...manifest.measures, ...manifest.combined })
    .filter(([, entry]) => entry.status !== "not_computable")
    .map(([key, entry]) => [
      key,
      Object.fromEntries(
        ["budgetary_impact", "metrics"].map((table) => [
          table,
          parseTable(table, fixtureText(`${entry.artifact}/${table}.csv`)),
        ]),
      ),
    ]),
);
const names = {
  alpha: "Alpha",
  beta: "Beta",
  gamma: "Gamma",
  delta: "Delta",
  epsilon: "Epsilon",
};

function renderStats(selectedIds, year) {
  const stats = combinedStats({ manifest, tablesByKey, selectedIds, year });
  return render(<CombinedStats stats={stats} measureNames={names} />);
}

describe("CombinedStats (UI regression)", () => {
  it("shows the combined run's statistics, not a member's", () => {
    const { container } = renderStats(["alpha", "beta"], IN_DATA);
    expect(container.textContent).not.toContain("-0.11pp");
    expect(container.textContent).not.toContain("-0.22pp");
    // While the poverty and people-affected figures are withheld
    // (povertyFigures.js), only the Gini card is drawn
    if (!POVERTY_FIGURES_SHOWN) {
      expect(container.textContent).not.toMatch(/People affected|poverty|-0\.28pp|7\.25%/);
      expect([...container.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Relative change in the Gini index"]);
      return;
    }
    // -2.75 / 10 from the combined run's own metrics row.
    expect(screen.getByText("-0.28pp")).toBeInTheDocument();
    expect(screen.getByText("7.25%")).toBeInTheDocument();
  });

  it("is the same whatever order the measures were selected in", () => {
    const first = renderStats(["alpha", "beta"], IN_DATA).container.innerHTML;
    const second = renderStats(["beta", "alpha"], IN_DATA).container.innerHTML;
    expect(second).toBe(first);
  });

  it("says combined figures are unavailable for a selection with no combined run", () => {
    const { container } = renderStats(["alpha", "gamma"], IN_DATA);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Combined figures are unavailable for this selection.",
    );
    expect(container.textContent).toContain(
      "Combined runs are published for: Alpha and Beta.",
    );
    expect(container.textContent).not.toContain("-0.11pp");
  });

  it("says combined figures are unavailable beyond the dataset's years", () => {
    const { container } = renderStats(["alpha", "beta"], BEYOND_DATA);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pp/);
  });

  it("shows no banner on a provisional measure's statistics from Budget day", () => {
    const { container } = renderStats(["gamma"], IN_DATA);
    expect(container.querySelector(".publication-provisional")).toBeNull();
    expect(container.textContent).not.toContain(PROVISIONAL_LABEL);
  });
});

describe("FiscalSummary", () => {
  it("shows each measure, the combined run and the interaction", () => {
    const series = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "beta"],
      years: [IN_DATA, BEYOND_DATA],
    });
    render(
      <FiscalSummary
        series={series}
        ids={["alpha", "beta"]}
        measureNames={names}
      />,
    );
    // The fiscal year starting in April of IN_DATA, written out here rather
    // than by the component's own formatter.
    const label = `${IN_DATA}-${String(IN_DATA + 1).slice(-2)}`;
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("-£1.10bn")).toBeInTheDocument();
    expect(screen.getByText("-£2.20bn")).toBeInTheDocument();
    expect(screen.getByText("-£2.75bn")).toBeInTheDocument();
    expect(screen.getByText("£0.55bn")).toBeInTheDocument();
    expect(screen.getByText("Interaction")).toBeInTheDocument();
    // The year beyond the data: every figure unavailable, with the reason,
    // never £0.00bn.
    expect(screen.queryByText("£0.00bn")).not.toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Beyond the dataset's projected years").length,
    ).toBe(3);
  });

  it("marks a provisional measure's own row beside an approved one", () => {
    const series = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "gamma"],
      years: [IN_DATA],
    });
    render(
      <FiscalSummary
        series={series}
        ids={["alpha", "gamma"]}
        measureNames={names}
      />,
    );
    const gamma = screen.getByRole("rowheader", { name: /Gamma/ });
    const alpha = screen.getByRole("rowheader", { name: /Alpha/ });
    expect(gamma).toHaveTextContent("(provisional)");
    expect(alpha).not.toHaveTextContent("(provisional)");
    expect(screen.getByText("£0.50bn")).toBeInTheDocument();
  });

  it("shows a dash, not zero, for a measure that is not published", () => {
    const series = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "delta"],
      years: [IN_DATA],
    });
    render(
      <FiscalSummary
        series={series}
        ids={["alpha", "delta"]}
        measureNames={names}
      />,
    );
    expect(screen.getByLabelText("Awaiting approval")).toHaveTextContent("—");
    expect(
      screen.getByLabelText("No combined run is published for this selection"),
    ).toHaveTextContent("—");
    expect(screen.queryByText("£0.00bn")).not.toBeInTheDocument();
  });
});

describe("FiscalSummary with a measure the data cannot cost", () => {
  it("shows a dash and the reason, never £0, even given tables of zeros", () => {
    // Its artifact holds no tables; zeros are supplied here, as an older
    // artifact held them, to show the page never reads them.
    const zeros = (rows) =>
      rows.map((row) => ({
        ...row,
        reform_id: "epsilon",
        reform_name: "Epsilon",
        value: 0,
      }));
    const withZeros = {
      ...tablesByKey,
      epsilon: {
        budgetary_impact: zeros(tablesByKey.alpha.budgetary_impact),
      },
    };
    const series = fiscalSeries({
      manifest,
      tablesByKey: withZeros,
      selectedIds: ["alpha", "epsilon"],
      years: [IN_DATA],
    });
    render(
      <FiscalSummary
        series={series}
        ids={["alpha", "epsilon"]}
        measureNames={names}
      />,
    );
    const reason = `Not computable on current data: ${manifest.measures.epsilon.reason}`;
    expect(screen.getByLabelText(reason)).toHaveTextContent("—");
    expect(screen.queryByText("£0.00bn")).not.toBeInTheDocument();
    expect(
      withZeros.epsilon.budgetary_impact.every((row) => row.value === 0),
    ).toBe(true);
  });
});

describe("UnavailableNotice", () => {
  it("is announced as a status", () => {
    render(<UnavailableNotice reason="Not yet published" />);
    expect(screen.getByRole("status")).toHaveTextContent("Not yet published");
  });
});

describe("BinnedHouseholdScatter", () => {
  it("draws cells, not households, and says when it cannot", async () => {
    const { default: BinnedHouseholdScatter, colourFor } =
      await import("./BinnedHouseholdScatter");
    const { container } = render(
      <BinnedHouseholdScatter
        series={{
          status: "unavailable",
          reason: "No combined run is published for this selection",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No combined run is published for this selection",
    );
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
    expect(colourFor({ changeBand: -150, changeBandUpper: -100 })).toBe(CHART_COLOURS.loss);
    expect(colourFor({ changeBand: -10, changeBandUpper: -1 })).toBe(CHART_COLOURS.loss);
    expect(colourFor({ changeBand: -1, changeBandUpper: 1 })).toBe(CHART_COLOURS.noChange);
    expect(colourFor({ changeBand: 1, changeBandUpper: 10 })).toBe(CHART_COLOURS.gain);
    expect(colourFor({ changeBand: 5000, changeBandUpper: 5000 })).toBe(CHART_COLOURS.gain);
    expect(colourFor({ changeBand: -5000, changeBandUpper: -5000 })).toBe(CHART_COLOURS.loss);
  });

  it("shows no banner on a Budget-day provisional scatter and explains the groups", async () => {
    const { default: BinnedHouseholdScatter } =
      await import("./BinnedHouseholdScatter");
    const { container } = render(
      <BinnedHouseholdScatter
        series={{
          status: "available",
          key: "gamma",
          provisional: true,
          points: [
            {
              income: 22500,
              change: 0,
              households: 1000,
              incomeBand: 20000,
              changeBand: -1,
              changeBandUpper: 1,
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".publication-provisional")).toBeNull();
    expect(container.textContent).not.toContain(PROVISIONAL_LABEL);
    expect(
      screen.getByText(/Groups with fewer than 10 surveyed households/),
    ).toBeInTheDocument();
  });
});

describe("the provisional label follows the manifest's dates", () => {
  // The fixture manifest was last written before its own Budget date: its
  // provisional entries are candidates. Rewritten on Budget day, they are
  // statement figures.
  const budgetDay = { ...manifest, updated_at: "2026-10-28T12:30:00+00:00" };
  const scatter = {
    status: "available",
    key: "gamma",
    provisional: true,
    points: [{ income: 22500, change: 0, households: 1000, incomeBand: 20000, changeBand: -1, changeBandUpper: 1 }],
  };

  it.each([
    ["before the Budget", manifest, CANDIDATE_PROVISIONAL_LABEL],
    ["from Budget day", budgetDay, null],
  ])("labels CombinedStats, FiscalSummary and BinnedHouseholdScatter %s", async (_, shown, label) => {
    const { default: BinnedHouseholdScatter } = await import("./BinnedHouseholdScatter");
    const stats = combinedStats({ manifest, tablesByKey, selectedIds: ["gamma"], year: IN_DATA });
    const series = fiscalSeries({ manifest, tablesByKey, selectedIds: ["alpha", "gamma"], years: [IN_DATA] });
    const views = [
      render(<CombinedStats stats={stats} measureNames={names} manifest={shown} />),
      render(<FiscalSummary series={series} ids={["alpha", "gamma"]} measureNames={names} manifest={shown} />),
      render(<BinnedHouseholdScatter series={scatter} manifest={shown} />),
    ];
    for (const view of views) {
      if (label) {
        expect(view.container.querySelector(".publication-provisional")).toHaveTextContent(label);
      } else {
        // Budget-day statement figures carry no banner on the page
        expect(view.container.querySelector(".publication-provisional")).toBeNull();
        expect(view.container.textContent).not.toContain(PROVISIONAL_LABEL);
      }
      view.unmount();
    }
  });
});
