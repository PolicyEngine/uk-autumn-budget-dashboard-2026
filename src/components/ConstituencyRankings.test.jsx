import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ConstituencyRankings from "./ConstituencyRankings";
import ConstituencyMap from "./ConstituencyMap";
import { downloadFile } from "../utils/downloadFile";
import {
  LOAD_FAILED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  resetConstituencyDataCache,
} from "../utils/constituencyData";
import { RANKING_CSV_COLUMNS } from "../utils/constituencyRanking";
import {
  constituencyFetch,
  makeConstituencies,
  makeConstituencyCsv,
  makeGeojson,
} from "../test/constituencyFixtures";

vi.mock("../utils/downloadFile", () => ({ downloadFile: vi.fn() }));

// TEST ONLY: the shipped verified set is empty (no certified constituency
// rows exist yet), so these tests verify the two synthetic policies below.
vi.mock("../utils/constituencyData", async (importOriginal) => ({
  ...(await importOriginal()),
  VERIFIED_CONSTITUENCY_POLICY_IDS: new Set([
    "two_child_limit",
    "fuel_duty_freeze",
  ]),
}));

// TEST DATA ONLY: synthetic constituencies. Seat i gains 10 * (i - 12) pounds
// from each policy; percentages run the other way so the two rankings differ.
const seats = makeConstituencies(25);
const POLICIES = ["two_child_limit", "fuel_duty_freeze"];
const csvFor = (
  constituencies,
  value = (p, y, i) => [10 * (i - 12), (12 - i) / 100],
) => makeConstituencyCsv(constituencies, POLICIES, [2029], value);

function serve(csvText, geojson = makeGeojson(seats)) {
  vi.stubGlobal("fetch", vi.fn(constituencyFetch(csvText, geojson)));
}

const renderRankings = () =>
  render(
    <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
  );

const tableRows = (name) =>
  within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);

beforeEach(() => {
  resetConstituencyDataCache();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ConstituencyRankings", () => {
  it("shows the top and bottom 10 by pound change", async () => {
    serve(csvFor(seats));
    renderRankings();

    expect(
      await screen.findByRole("heading", {
        name: /Constituency rankings, 2029-30/,
      }),
    ).toBeInTheDocument();
    const top = tableRows("Largest gains (£ per household)");
    const bottom = tableRows("Largest losses (£ per household)");
    expect(top).toHaveLength(10);
    expect(bottom).toHaveLength(10);

    // Seat 25 gains 2 x £120; seat 1 loses 2 x £120. jsdom applies no CSS, so
    // each row's text holds the region twice: the column, and the copy shown
    // under the name on narrow screens (after a screen-reader-only comma).
    expect(top[0]).toHaveTextContent(
      /^1Test seat 25, North EastNorth East\+£240-0\.24%$/,
    );
    expect(bottom[0]).toHaveTextContent(
      /^25Test seat 1, North, North EastNorth East-£240\+0\.24%$/,
    );
    // Seat 22 is in "Greater London" in the geojson, shown with its ONS name.
    expect(top[3]).toHaveTextContent(/^4Test seat 22, LondonLondon\+£180/);
  });

  it("marks the ranked column as sorted for assistive technology", async () => {
    serve(csvFor(seats));
    renderRankings();
    const top = await screen.findByRole("table", { name: /Largest gains/ });
    const bottom = screen.getByRole("table", { name: /Largest losses/ });
    expect(
      within(top).getByRole("columnheader", { name: "Change (£)" }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(
      within(bottom).getByRole("columnheader", { name: "Change (£)" }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(
      within(top).getByRole("columnheader", { name: "Change (%)" }),
    ).not.toHaveAttribute("aria-sort");
  });

  it("re-ranks by percentage change", async () => {
    serve(csvFor(seats));
    renderRankings();
    fireEvent.click(await screen.findByRole("button", { name: "% of income" }));

    expect(screen.getByRole("button", { name: "% of income" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(tableRows("Largest gains (% of income)")[0]).toHaveTextContent(
      "Test seat 1, North",
    );
  });

  it("calls a list of negative values smallest losses, not gains", async () => {
    serve(csvFor(seats, (p, y, i) => [-1 - i, -0.01 - i / 100]));
    renderRankings();
    expect(
      await screen.findByRole("table", {
        name: "Smallest losses (£ per household)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Largest losses (£ per household)" }),
    ).toBeInTheDocument();
  });

  it("marks tied ranks with an equals sign and says 'tied' to screen readers", async () => {
    serve(
      csvFor(seats, (p, y, i) =>
        i >= 22 ? [500, 1] : [10 * (i - 12), i / 100],
      ),
    );
    renderRankings();
    await screen.findByRole("table", { name: /Largest gains/ });
    const rankCell = within(tableRows(/Largest gains/)[0]).getAllByRole(
      "cell",
    )[0];
    expect(rankCell).toHaveTextContent("=tied 1");
    expect(rankCell.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "=",
    );
  });

  it("says how many tied constituencies a cut leaves out", async () => {
    // Eight distinct high values, then seven seats tied, then ten below.
    serve(
      csvFor(seats, (p, y, i) =>
        i >= 17 ? [i * 100, i] : i >= 10 ? [50, 0.5] : [i - 20, (i - 20) / 100],
      ),
    );
    renderRankings();
    expect(
      await screen.findByText(
        "7 constituencies are tied at rank =9; this table shows 2 of them, in name order. The CSV lists them all.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no ranking when every constituency has the same value", async () => {
    serve(csvFor(seats, () => [0, 0]));
    renderRankings();
    expect(
      await screen.findByText(
        /Every constituency has the same average change \(£0\) in 2029-30, so there is no ranking/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("downloads every constituency as an Excel-readable CSV", async () => {
    const all = makeConstituencies(650);
    serve(
      csvFor(all, (p, y, i) => [i - 300, (i - 300) / 100]),
      makeGeojson(all),
    );
    render(
      <ConstituencyRankings
        selectedPolicies={[...POLICIES, POLICIES[0]]}
        selectedYear={2029}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Download all 650 (CSV)" }),
    );
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [csv, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(651);
    expect(lines[0]).toBe(`﻿${RANKING_CSV_COLUMNS.join(",")}`);
    // A repeated policy in the URL is listed once.
    expect(
      lines[1].endsWith(",2029,2029-30,two_child_limit;fuel_duty_freeze"),
    ).toBe(true);
    expect(filename).toBe("constituency-rankings-2029-by-gbp.csv");
    expect(mimeType).toMatch(/^text\/csv/);
  });

  it("labels the tables and the file as MOCK in a mock build", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
    serve(csvFor(seats));
    renderRankings();

    expect(await screen.findByText("MOCK DATA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download all/ }));
    const [csv, filename] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename.startsWith("MOCK-")).toBe(true);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0].startsWith("﻿data_status,")).toBe(true);
    expect(lines.slice(1).every((line) => line.startsWith("MOCK,"))).toBe(true);
  });
});

// The tables must follow the map's availability flag exactly: whenever the
// map says constituency estimates are unavailable, no table renders.
describe("hidden when constituency data are unavailable", () => {
  const missingSeat = csvFor(seats)
    .split("\n")
    .filter((line) => !line.includes(`,${seats[3].code},`))
    .join("\n");

  const cases = [
    [
      "a selected policy has no verified constituency results",
      csvFor(seats),
      ["two_child_limit", "bus_fare_cap"],
      2029,
    ],
    ["a constituency is missing", missingSeat, POLICIES, 2029],
    [
      "the selected year has no constituency rows",
      csvFor(seats),
      POLICIES,
      2030,
    ],
    [
      "a value is not a number",
      csvFor(seats, (p, y, i) => (i === 7 ? ["", 0.1] : [1, 0.1])),
      POLICIES,
      2029,
    ],
  ];

  it.each(cases)(
    "hides the tables when %s",
    async (_, csvText, policies, year) => {
      serve(csvText);
      const { container } = render(
        <>
          <ConstituencyMap selectedPolicies={policies} selectedYear={year} />
          <ConstituencyRankings
            selectedPolicies={policies}
            selectedYear={year}
          />
        </>,
      );
      expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(container.querySelector(".constituency-rankings")).toBeNull();
    },
  );

  it("hides the tables and says so when the data fail to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    render(
      <>
        <ConstituencyMap selectedPolicies={POLICIES} selectedYear={2029} />
        <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />
      </>,
    );
    expect(await screen.findByText(LOAD_FAILED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders nothing with no policy selected", async () => {
    serve(csvFor(seats));
    const { container } = render(
      <ConstituencyRankings selectedPolicies={[]} selectedYear={2029} />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the map and the tables together when data are available", async () => {
    serve(csvFor(seats));
    render(
      <>
        <ConstituencyMap selectedPolicies={POLICIES} selectedYear={2029} />
        <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />
      </>,
    );
    expect(
      await screen.findByRole("heading", {
        name: /Constituency-level impacts, 2029-30/,
      }),
    ).toBeInTheDocument();
    expect(await screen.findAllByRole("table")).toHaveLength(2);
    expect(screen.queryByText(UNAVAILABLE_MESSAGE)).not.toBeInTheDocument();
    // One shared download serves both components.
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
