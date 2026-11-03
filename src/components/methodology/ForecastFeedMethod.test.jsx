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

  it("names the March 2026 EFO for an outlook run on it", async () => {
    stub(outlookWith("2031-32 is past the OBR March 2026 forecast, so it uses policyengine-uk's long-run assumptions (CPI 2.0%, earnings growth 3.3%)."));
    render(<ForecastFeedMethod />);
    expect(await screen.findByText(/CPI 2\.0%, earnings growth 3\.3%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /March 2026/ })).toBeInTheDocument();
  });
});
