import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ForecastFeedMethod from "./ForecastFeedMethod";
import { clearOutlookCache } from "../../utils/livingStandards/outlook";

const outlookWith = (note) => ({ meta: { headline_end_year_note: note, policyengine_uk: "2.151.0" }, forecast: { sections: [] } });
const stub = (data) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));

afterEach(() => {
  cleanup();
  clearOutlookCache();
  vi.unstubAllGlobals();
});

describe("How the forecast feeds the baseline", () => {
  it("names the October 2026 EFO and the year it ends in, once the outlook is run on it", async () => {
    stub(outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/last calendar year, 2031, covers 2031-32/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /October 2026/ })).toBeInTheDocument();
    expect(screen.queryByText(/past the OBR forecast/)).toBeNull();
  });

  // policyengine-uk 2.151.2 and later raise the minimum guarantee with the
  // earnings floor of the Social Security Administration Act 1992, section
  // 150A(2) (minimum_guarantee.yaml: uprating indices.earnings_uprating);
  // 2.151.0 raised it with CPI, which the page said until the engine moved
  it("says the Pension Credit guarantee rises with average earnings, not CPI", async () => {
    stub(outlookWith("2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/The Pension Credit guarantee rises with average earnings, the least the law allows\./)).toBeInTheDocument();
    expect(screen.queryByText(/raises the Pension Credit guarantee with CPI/)).toBeNull();
  });

  it("names the March 2026 EFO for an outlook run on it", async () => {
    stub(outlookWith("2031-32 is past the OBR March 2026 forecast, so it uses policyengine-uk's long-run assumptions (CPI 2.0%, earnings growth 3.3%)."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/CPI 2\.0%, earnings growth 3\.3%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /March 2026/ })).toBeInTheDocument();
  });
});
