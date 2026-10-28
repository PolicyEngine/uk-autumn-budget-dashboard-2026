import { describe, expect, it } from "vitest";
import { outlookForecastSource } from "./outlook";

describe("the forecast the outlook was run on", () => {
  it("is the October 2026 EFO once the end-year note names it", () => {
    const meta = { headline_end_year_note: "2031-32 is the last year of the OBR October 2026 forecast (calendar 2031: CPI 2.0%, earnings growth 2.6%); from 2032 policyengine-uk's long-run assumptions apply." };
    expect(outlookForecastSource(meta)).toBe("obr_efo_october_2026");
  });

  it("is the March 2026 EFO otherwise", () => {
    expect(outlookForecastSource({ headline_end_year_note: "2031-32 is past the OBR March 2026 forecast, so it uses policyengine-uk's long-run assumptions (CPI 2.0%, earnings growth 3.3%)." })).toBe("obr_efo_march_2026");
    expect(outlookForecastSource(null)).toBe("obr_efo_march_2026");
  });
});
