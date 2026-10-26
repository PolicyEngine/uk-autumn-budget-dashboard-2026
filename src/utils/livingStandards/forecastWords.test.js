import { describe, expect, it } from "vitest";
import { cardSentence, tileMeaning } from "./forecastWords";

const rows = (...values) => values.map((value, i) => ({ year: String(2027 + i), value }));
const words = (s) => s.split(/\s+/).length;

describe("the forecast's sentences", () => {
  const cpi = rows(2, 2, 2, 2);
  const byKey = { cpi };

  it("says what a tile means without repeating its figure", () => {
    expect(tileMeaning("cpi", cpi, byKey)).toBe("Holds at this rate to 2030, in line with the 2% inflation target.");
    expect(tileMeaning("rpi", rows(3, 2.8, 2.9, 2.3), byKey)).toBe("Runs 1.0 point above CPI in 2027; eases to 2.3% by 2030.");
    expect(tileMeaning("earnings", rows(2.4, 2.1, 2.2, 2.4), byKey)).toBe(
      "Pay outpaces CPI prices by 0.4 points in 2027, so average real earnings rise.",
    );
    expect(tileMeaning("earnings", rows(1.5), byKey)).toMatch(/^Pay lags CPI prices by 0.5 points/);
  });

  it("leads each card with its finding, in at most 20 words", () => {
    const cards = {
      prices: { cpi, cpih: rows(2.11, 2.04, 2.09, 2.12), cpi_ahc: rows(1.9, 1.9, 1.9, 1.9), rpi: rows(3, 2.8, 2.9, 2.3) },
      income: { earnings: rows(2.4, 2.1, 2.2, 2.4), non_labour_income: rows(5.13, 3.5, 3.01, 3.17) },
      homes: { house_prices: rows(2.9, 2.7, 2.6, 2.4), rent: rows(3.02, 2.3, 2.38, 2.58), social_rent: rows(3.3, 3, 3, 3) },
      mortgage: { mortgage_interest: rows(10.4, 4.76, 4.68, 5.53) },
    };
    const said = Object.fromEntries(Object.entries(cards).map(([id, s]) => [id, cardSentence(id, s)]));
    expect(said.prices).toBe("RPI runs 0.3 to 1.0 points above CPI each year; CPIH and CPI after housing costs stay close to CPI.");
    expect(said.income).toBe("Non-labour income grows faster than average earnings every year, by 2.7 points in 2027.");
    expect(said.homes).toBe("House price growth eases from 2.9% to 2.4% by 2030; rents grow 2.3% to 3.0% a year.");
    expect(said.mortgage).toBe("Mortgage interest payments rise 10.4% in 2027, then 4.7% to 5.5% a year.");
    for (const s of Object.values(said)) expect(words(s)).toBeLessThanOrEqual(20);
  });
});
