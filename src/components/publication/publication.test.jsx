import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CombinedStats from "./CombinedStats";
import FiscalSummary from "./FiscalSummary";
import UnavailableNotice from "./UnavailableNotice";
import { parseTable } from "../../utils/publication/csv";
import { parseManifest } from "../../utils/publication/manifest";
import { combinedStats, fiscalSeries } from "../../utils/publication/select";
import { fixtureJson, fixtureText } from "../../test/publicationFixture";

const manifest = parseManifest(fixtureJson("manifest.json"));
const tablesByKey = Object.fromEntries(
  Object.entries({ ...manifest.measures, ...manifest.combined }).map(
    ([key, entry]) => [
      key,
      Object.fromEntries(
        ["budgetary_impact", "metrics"].map((table) => [
          table,
          parseTable(table, fixtureText(`${entry.artifact}/${table}.csv`)),
        ]),
      ),
    ],
  ),
);
const names = { alpha: "Alpha", beta: "Beta", gamma: "Gamma", delta: "Delta" };

function renderStats(selectedIds, year) {
  const stats = combinedStats({ manifest, tablesByKey, selectedIds, year });
  return render(<CombinedStats stats={stats} measureNames={names} />);
}

describe("CombinedStats (UI regression)", () => {
  it("shows the combined run's statistics, not a member's", () => {
    const { container } = renderStats(["alpha", "beta"], 2030);
    // -2.75 / 10 from the combined run's own metrics row.
    expect(screen.getByText("-0.28pp")).toBeInTheDocument();
    expect(container.textContent).not.toContain("-0.11pp");
    expect(container.textContent).not.toContain("-0.22pp");
    expect(screen.getByText("7.25%")).toBeInTheDocument();
  });

  it("is the same whatever order the measures were selected in", () => {
    const first = renderStats(["alpha", "beta"], 2030).container.innerHTML;
    const second = renderStats(["beta", "alpha"], 2030).container.innerHTML;
    expect(second).toBe(first);
  });

  it("says combined figures are unavailable for a selection with no combined run", () => {
    const { container } = renderStats(["alpha", "gamma"], 2030);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Combined figures are unavailable for this selection.",
    );
    expect(container.textContent).toContain(
      "Combined runs are published for: Alpha and Beta.",
    );
    expect(container.textContent).not.toContain("-0.11pp");
  });

  it("says combined figures are unavailable beyond the dataset's years", () => {
    const { container } = renderStats(["alpha", "beta"], 2031);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pp/);
  });

  it("labels a provisional measure's statistics", () => {
    renderStats(["gamma"], 2030);
    expect(
      screen.getByText(
        "Provisional: statement figures, awaiting Treasury costing",
      ),
    ).toBeInTheDocument();
  });
});

describe("FiscalSummary", () => {
  it("shows each measure, the combined run and the interaction", () => {
    const series = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "beta"],
      years: [2030, 2031],
    });
    render(
      <FiscalSummary
        series={series}
        ids={["alpha", "beta"]}
        measureNames={names}
      />,
    );
    expect(screen.getByText("2030-31")).toBeInTheDocument();
    expect(screen.getByText("-£1.10bn")).toBeInTheDocument();
    expect(screen.getByText("-£2.20bn")).toBeInTheDocument();
    expect(screen.getByText("-£2.75bn")).toBeInTheDocument();
    expect(screen.getByText("£0.55bn")).toBeInTheDocument();
    // 2031: every figure unavailable, with the reason, never £0.00bn.
    expect(screen.queryByText("£0.00bn")).not.toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Beyond the dataset's projected years").length,
    ).toBe(3);
  });

  it("shows a dash, not zero, for a measure that is not published", () => {
    const series = fiscalSeries({
      manifest,
      tablesByKey,
      selectedIds: ["alpha", "delta"],
      years: [2030],
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

describe("UnavailableNotice", () => {
  it("is announced as a status", () => {
    render(<UnavailableNotice reason="Not yet published" />);
    expect(screen.getByRole("status")).toHaveTextContent("Not yet published");
  });
});
