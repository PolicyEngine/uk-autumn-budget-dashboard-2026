import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseFixtureFetch } from "../../test/historicalFixture";
import { HISTORICAL_RELEASES } from "../../utils/publication/release";

// The decile charts stand in here, so the props a past event's page gives
// them can be read. What the charts do with `pastEvent` is tested in
// HouseholdChartLegends.test.jsx. The page reads the publication fixture,
// synthetic data only.
const charts = vi.hoisted(() => ({ props: {} }));
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

const { default: HistoricalReleasePage } = await import("./HistoricalReleasePage");
const RELEASE = HISTORICAL_RELEASES[0];

beforeEach(async () => {
  charts.props = {};
  vi.stubGlobal("fetch", vi.fn(await releaseFixtureFetch(RELEASE)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a past event's decile charts", () => {
  it("are told they are a past event's, so no £0 measure gets this Budget's reason", async () => {
    const { container } = render(<HistoricalReleasePage releaseId={RELEASE.id} />);
    await screen.findByText("Today's model and data, not what was known at the time.", {}, { timeout: 5000 });
    expect(container.querySelector('[data-chart="WaterfallChart"]')).not.toBeNull();
    expect(container.querySelector('[data-chart="DistributionalChart"]')).not.toBeNull();
    expect(charts.props.WaterfallChart.pastEvent).toBe(true);
    expect(charts.props.DistributionalChart.pastEvent).toBe(true);
  });
});
