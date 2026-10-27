import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PaySectorsCard, { PAY_SECTORS_TITLE, paySourceText } from "./PaySectorsCard";
import { clearPaySectorsCache, growthRows, isPaySectors, paySectorsSentence } from "../../utils/livingStandards/paySectors";

// A short file of the shape tools/fetch-ons-pay-growth.mjs writes (the
// published file waits on its review row)
const series = (key, cdid, values) => ({
  key,
  cdid,
  dataset: "LMS",
  title: `AWE: ${key} Year on Year Three Month Average Growth (%): Seasonally Adjusted Regular Pay Excluding Arrears`,
  unit: "%",
  seasonally_adjusted: true,
  source_url: `https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/${cdid.toLowerCase()}/lms`,
  release_date: "2026-10-20",
  next_release: "17 November 2026",
  values: values.map(([month, value]) => ({ month, value })),
});
const FILE = {
  schema: "uk-budget-dashboard/pay-growth-sectors/v1",
  publisher: "Office for National Statistics",
  start_month: "2026-01",
  series: [
    series("public", "KAJ7", [["2026-01", 4.1], ["2026-07", 6.3], ["2026-08", 6.3]]),
    series("private", "KAJ4", [["2026-01", 3.4], ["2026-07", 2.9], ["2026-08", 3.0]]),
    series("whole", "KAI9", [["2026-01", 3.6], ["2026-07", 3.6], ["2026-08", 3.7]]),
  ],
};

const serve = (status, body) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body ? JSON.stringify(body) : "", { status })));

beforeEach(() => {
  clearPaySectorsCache();
  serve(200, FILE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pay growth by sector", () => {
  it("reads the file as published, one row per month", () => {
    expect(isPaySectors(FILE)).toBe(true);
    expect(isPaySectors({ ...FILE, schema: "other" })).toBe(false);
    const rows = growthRows(FILE);
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-07", "2026-08"]);
    expect(rows.at(-1)).toEqual({ month: "2026-08", public: 6.3, private: 3.0, whole: 3.7 });
  });

  it("says the latest public and private rates in one sentence", () => {
    expect(paySectorsSentence(growthRows(FILE))).toBe(
      "In the three months to August 2026, public-sector regular pay grew 6.3% and private-sector 3.0%.",
    );
  });

  it("shows the title, the sentence and a chip per line", async () => {
    render(<PaySectorsCard />);
    expect(await screen.findByText(/^In the three months to August 2026/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: PAY_SECTORS_TITLE })).toBeTruthy();
    for (const name of ["Public sector", "Private sector", "Whole economy"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("table view lists every month", async () => {
    render(<PaySectorsCard view="table" onViewChange={() => {}} />);
    await screen.findByText(/^In the three months/);
    const last = [...document.querySelectorAll(".ls-table tbody tr")].at(-1);
    expect([...last.cells].map((c) => c.textContent)).toEqual(["Aug 2026", "6.3%", "3.0%", "3.7%"]);
  });

  it("About this chart cites the ONS note on public-sector pay awards and lists each series by CDID", async () => {
    render(<PaySectorsCard />);
    await screen.findByText(/^In the three months/);
    fireEvent.click(screen.getByRole("button", { name: /About this chart/ }));
    expect(screen.getByText(/timing of some pay awards this year/)).toBeTruthy();
    for (const cdid of ["KAJ7", "KAJ4", "KAI9"]) expect(screen.getByText(new RegExp(`\\(${cdid}, LMS\\)`))).toBeTruthy();
    expect(screen.getByRole("link", { name: /Average weekly earnings in Great Britain: October 2026/ })).toBeTruthy();
  });

  it("names the dataset and CDIDs for the downloads", () => {
    expect(paySourceText(FILE.series)).toMatch(/^ONS, Labour market statistics \(LMS: KAJ7, KAJ4, KAI9\)/);
  });

  it("says not yet available, holding its place, before the file is published", async () => {
    serve(404);
    render(<PaySectorsCard />);
    expect(await screen.findByText("ONS pay growth by sector is not yet available.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: PAY_SECTORS_TITLE })).toBeTruthy();
  });

  it("says why when the file cannot be read", async () => {
    serve(500);
    render(<PaySectorsCard />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load the ONS pay data/);
  });
});
