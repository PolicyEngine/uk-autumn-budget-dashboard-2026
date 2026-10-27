import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseFixtureFetch } from "../../test/historicalFixture";
import { HISTORICAL_RELEASES } from "../../utils/publication/release";

// The charts stand in here, so the props a past event's view gives them can
// be read. What the charts do with `pastEvent` is tested in
// HouseholdChartLegends.test.jsx and BudgetaryImpactChart.test.jsx. The page
// reads the publication fixture, synthetic data only.
const charts = vi.hoisted(() => ({ props: {} }));
vi.mock("../BudgetaryImpactChart", () => ({
  default: (props) => {
    charts.props.BudgetaryImpactChart = props;
    return <div data-chart="BudgetaryImpactChart" />;
  },
}));
vi.mock("../WaterfallChart", () => ({
  default: (props) => {
    charts.props.WaterfallChart = props;
    return <div data-chart="WaterfallChart" />;
  },
}));
vi.mock("../DistributionalChart", () => ({
  default: (props) => {
    charts.props.DistributionalChart = props;
    return <div data-chart="DistributionalChart" />;
  },
}));

const { default: App } = await import("../../App");
const RELEASE = HISTORICAL_RELEASES[0];

beforeEach(async () => {
  charts.props = {};
  vi.stubGlobal("fetch", vi.fn(await releaseFixtureFetch(RELEASE)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a past event's charts", () => {
  it("are told they are a past event's, so no £0 measure gets this Budget's reason", async () => {
    const { container } = render(<App releaseId={RELEASE.id} />);
    await screen.findByText("Today's model and data, not what was known at the time.", {}, { timeout: 5000 });
    // The charts follow the banner, once the event's figures have loaded
    await waitFor(() => expect(container.querySelector('[data-chart="WaterfallChart"]')).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector('[data-chart="DistributionalChart"]')).not.toBeNull();
    expect(charts.props.WaterfallChart.pastEvent).toBe(true);
    expect(charts.props.DistributionalChart.pastEvent).toBe(true);
  });

  it("and so is its revenue chart, whose About this chart names no measure of this Budget's", async () => {
    const { container } = render(<App releaseId={RELEASE.id} />);
    await screen.findByText("Today's model and data, not what was known at the time.", {}, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector('[data-chart="BudgetaryImpactChart"]')).not.toBeNull(), { timeout: 5000 });
    expect(charts.props.BudgetaryImpactChart.pastEvent).toBe(true);
  });
});
