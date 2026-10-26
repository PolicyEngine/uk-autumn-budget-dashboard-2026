// Source lines in each Living standards card's "About this chart", the plain-words
// substitution for the "HBAI" abbreviation in text taken from the outlook
// data, and the CSV source strings. Ported from
// PolicyEngine/uk-living-standards-outlook src/lib/sources.jsx.

import { fyDash } from "../../utils/livingStandards/outlook";

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

/**
 * The forecast's source: the OBR release(s) named in the outlook data
 * (forecast.pre_source, and forecast.post_source once the Budget forecast
 * is published), or OBR March 2026 when the file names none.
 */
function obrSources(forecast) {
  const pre = forecast?.pre_source?.release
    ? { name: forecast.pre_source.release, url: forecast.pre_source.url || OBR_EFO_URL }
    : { name: "OBR, Economic and fiscal outlook (March 2026)", url: OBR_EFO_URL };
  const post =
    forecast?.post_published && forecast?.post_source?.release
      ? { name: forecast.post_source.release, url: forecast.post_source.url || null }
      : null;
  return { pre, post };
}

const linked = ({ name, url }) =>
  url ? (
    <a href={url} {...ext}>
      {name}
    </a>
  ) : (
    name
  );

/** Source of the OBR forecast series (charts, tables and tiles). */
export function ForecastSource({ forecast, derived = false }) {
  if (derived) return <PeDerivedSource />;
  const { pre, post } = obrSources(forecast);
  return (
    <>
      <Label />{" "}
      {post ? (
        <>
          {linked(post)}; earlier forecast: {linked(pre)}
        </>
      ) : (
        linked(pre)
      )}
    </>
  );
}

/** The same, as plain text for the CSV and image downloads. */
export function forecastSourceText(forecast, derived = false) {
  if (derived) return CSV_SOURCES.peDerived;
  const { pre, post } = obrSources(forecast);
  return post ? `${post.name}; earlier forecast: ${pre.name}` : pre.name;
}

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

/** The same sources as About this chart's Source items (InfoSections). */
export const HBAI_SOURCE = { label: "DWP, Households Below Average Income", href: HBAI_URL, date: "March 2026" };
export const OBR_SOURCE = { label: "OBR, Economic and fiscal outlook", href: OBR_EFO_URL, date: "March 2026" };

/** The forecast's OBR release(s), as Source items. */
export function forecastSources(forecast) {
  const { pre, post } = obrSources(forecast);
  const item = ({ name, url }) => ({ label: name, href: url || undefined });
  return post ? [item(post), { ...item(pre), note: "earlier forecast" }] : [item(pre)];
}

/**
 * A note from the outlook data in plain words, without the outside
 * analysts the pipeline's notes compared against (the page names only data
 * sources): their names and the comparisons go.
 */
export function scrubNote(text) {
  const plain = fyDash(plainWords(text));
  if (/JRF's figure|Resolution Foundation/.test(plain)) {
    return plain
      .replace(/ is well below JRF's figure of about [^,]+ \([^)]*\), so read it/, ", so read it")
      .replace(/, not the typical \(median\) incomes in Resolution Foundation analysis/, ", not medians");
  }
  return plain.replace(/, as JRF defines very deep poverty/, "").replace(/ ?\(?JRF-style\)?/, "");
}
