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
  UNAVAILABLE_MESSAGE,
  resetConstituencyDataCache,
} from "../utils/constituencyData";
import {
  constituencyFetch,
  makeConstituencies,
  makeConstituencyCsv,
  makeGeojson,
} from "../test/constituencyFixtures";

vi.mock("../utils/downloadFile", () => ({ downloadFile: vi.fn() }));

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

const tableRows = (name) =>
  within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);

beforeEach(() => {
  resetConstituencyDataCache();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ConstituencyRankings", () => {
  it("shows the top and bottom 10 by pound change", async () => {
    serve(csvFor(seats));
    render(
      <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
    );

    expect(
      await screen.findByRole("heading", {
        name: /Constituency rankings, 2029-30/,
      }),
    ).toBeInTheDocument();
    const top = tableRows(/Highest average change/);
    const bottom = tableRows(/Lowest average change/);
    expect(top).toHaveLength(10);
    expect(bottom).toHaveLength(10);

    // Seat 25 gains 2 x £120; seat 1 loses 2 x £120.
    expect(top[0]).toHaveTextContent(
      /^1Test seat 25(North East){2}\+£240-0\.24%$/,
    );
    expect(bottom[0]).toHaveTextContent(
      /^25Test seat 1, North(North East){2}-£240\+0\.24%$/,
    );
    // Seat 22 is in "Greater London" in the geojson, shown with its ONS name.
    // jsdom applies no CSS, so each row's text holds the region twice: the
    // column and the copy shown under the name on narrow screens.
    expect(top[3]).toHaveTextContent(/^4Test seat 22(London){2}\+£180/);
  });

  it("re-ranks by percentage change", async () => {
    serve(csvFor(seats));
    render(
      <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "% of income" }));

    expect(screen.getByRole("button", { name: "% of income" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(tableRows(/Highest average change/)[0]).toHaveTextContent(
      "Test seat 1, North",
    );
  });

  it("marks tied ranks with an equals sign", async () => {
    serve(csvFor(seats, () => [5, 0.1]));
    render(
      <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
    );
    const top = await screen.findByRole("table", {
      name: /Highest average change/,
    });
    expect(within(top).getAllByTitle("Tied")[0]).toHaveTextContent("=1");
  });

  it("downloads every constituency as CSV", async () => {
    const all = makeConstituencies(650);
    serve(
      csvFor(all, (p, y, i) => [i - 300, (i - 300) / 100]),
      makeGeojson(all),
    );
    render(
      <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Download all 650 (CSV)" }),
    );
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [csv, filename, mimeType] = vi.mocked(downloadFile).mock.calls[0];
    expect(csv.trimEnd().split("\n")).toHaveLength(651);
    expect(filename).toBe("constituency-rankings-2029-by-gbp.csv");
    expect(mimeType).toMatch(/^text\/csv/);
  });

  it("labels the tables and the file as MOCK in a mock build", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
    serve(csvFor(seats));
    render(
      <ConstituencyRankings selectedPolicies={POLICIES} selectedYear={2029} />,
    );

    expect(await screen.findByText("MOCK DATA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download all/ }));
    const [csv, filename] = vi.mocked(downloadFile).mock.calls[0];
    expect(filename.startsWith("MOCK-")).toBe(true);
    expect(
      csv
        .trimEnd()
        .split("\n")
        .slice(1)
        .every((line) => line.startsWith("MOCK,")),
    ).toBe(true);
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

  it("hides the tables when the data fail to load", async () => {
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
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
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
