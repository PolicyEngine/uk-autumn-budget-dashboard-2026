// Source lines under each Living standards chart, the plain-words
// substitution for the "HBAI" abbreviation in text taken from the outlook
// data, and the CSV source strings. Ported from
// PolicyEngine/uk-living-standards-outlook src/lib/sources.jsx.

export const HBAI_URL =
  "https://www.gov.uk/government/statistics/households-below-average-income-for-financial-years-ending-1995-to-2025";
export const HBAI_TITLE = "Households Below Average Income: FYE 1995 to FYE 2025";
export const OBR_EFO_URL = "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/";
export const OBR_EFO_TITLE = "Economic and fiscal outlook – March 2026";

const ext = { target: "_blank", rel: "noopener noreferrer" };

export const Label = () => <span className="ls-source-label">Source:</span>;

export const HbaiSource = () => (
  <>
    <Label />{" "}
    <a href={HBAI_URL} {...ext}>
      DWP, Households Below Average Income
    </a>{" "}
    (March 2026) · PolicyEngine projections
  </>
);

export const ObrSource = () => (
  <>
    <Label />{" "}
    <a href={OBR_EFO_URL} {...ext}>
      OBR, Economic and fiscal outlook
    </a>{" "}
    (March 2026)
  </>
);

export const PeDerivedSource = () => (
  <>
    <Label /> PolicyEngine calculation from ONS and OBR data
  </>
);

export const PeSource = () => (
  <>
    <Label /> PolicyEngine projections
  </>
);

/** Spell out "HBAI" in text from outlook.json. */
export function plainWords(text) {
  return String(text ?? "")
    .replace(/HBAI's (self-reported )?definition/g, "the $1definition in official statistics")
    .replace(/HBAI uses/g, "official statistics use")
    .replace(/HBAI's/g, "official statistics")
    .replace(/(the )?HBAI admin-linked series/g, "the official admin-linked series")
    .replace(/\bHBAI\b/g, "Households Below Average Income");
}

/** Source strings for the CSV downloads (the chart's own source line). */
export const CSV_SOURCES = {
  hbai: "DWP, Households Below Average Income (March 2026); PolicyEngine projections",
  pe: "PolicyEngine projections",
  obr: "OBR, Economic and fiscal outlook (March 2026)",
  peDerived: "PolicyEngine calculation from ONS and OBR data",
};
