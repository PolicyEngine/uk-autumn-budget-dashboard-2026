import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import ObrCpiEffectCard, { HOUSEHOLDS_LINK, obrCpiSourceText } from "./ObrCpiEffectCard";
import { CURRENT_BUDGET, OBR_CPI_EFFECT_TITLE, clearObrCpiEffectCache, parseObrCpiEffect } from "../../utils/livingStandards/obrCpiEffect";
import { AB2025_CPI_EFFECT } from "../../utils/livingStandards/obrCpiEffect.fixture";

const PREVIEW_TITLE = "Effect of the Budget's measures on CPI inflation, Autumn Budget 2025 (OBR, November 2025)";

function serve(doc) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      doc && String(url).endsWith("obr_cpi_policy_effect.json")
        ? new Response(JSON.stringify(doc), { status: 200 })
        : new Response("", { status: 404 }),
    ),
  );
}

beforeEach(() => clearObrCpiEffectCache());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Effect of the Budget's measures on CPI inflation (OBR)", () => {
  it("draws the earlier Budget's figures under a title that names them", async () => {
    serve(AB2025_CPI_EFFECT);
    render(<ObrCpiEffectCard />);
    const heading = await screen.findByRole("heading", { level: 3, name: PREVIEW_TITLE });
    const card = heading.closest(".ls-card");
    expect(
      within(card).getByText(
        "The OBR estimates the Budget's measures lower CPI inflation by 0.4 percentage points in 2026-27 and raise it by 0.1 points in each of the next two years.",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: HOUSEHOLDS_LINK })).toHaveAttribute("href", "?tab=dashboard");
  });

  it("is this Budget's card, untitled by Budget, once the file is this Budget's", async () => {
    const doc = structuredClone(AB2025_CPI_EFFECT);
    doc.budget = CURRENT_BUDGET;
    delete doc.previous_budget;
    serve(doc);
    render(<ObrCpiEffectCard />);
    expect(await screen.findByRole("heading", { level: 3, name: OBR_CPI_EFFECT_TITLE })).toBeInTheDocument();
  });

  it("shows each year's total and measures as a table", async () => {
    serve(AB2025_CPI_EFFECT);
    render(<ObrCpiEffectCard view="table" />);
    const heading = await screen.findByRole("heading", { level: 3, name: PREVIEW_TITLE });
    const table = within(heading.closest(".ls-card")).getByRole("table");
    const row = within(table).getByRole("row", { name: /2026-27/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2026-27", "−0.43"]);
  });

  it("is not drawn before the file is published, nor for an unlabelled earlier Budget", async () => {
    serve(null);
    const { container } = render(<ObrCpiEffectCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    clearObrCpiEffectCache();
    const doc = structuredClone(AB2025_CPI_EFFECT);
    delete doc.previous_budget;
    serve(doc);
    const again = render(<ObrCpiEffectCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(again.container).toBeEmptyDOMElement();
  });

  it("cites the OBR's chart, page and workbook sheet", () => {
    expect(obrCpiSourceText(parseObrCpiEffect(AB2025_CPI_EFFECT))).toBe(
      "OBR, Economic and fiscal outlook, November 2025: Chart 3.4: Impact of Budget policies on CPI inflation, page 64, chapter 3 charts and tables workbook, sheet C3.4",
    );
  });
});
