import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PlotSkeleton } from "./publication/LoadingSkeleton";
import SwapTransition from "./SwapTransition";
import * as d3 from "d3";
import { CHART_MOTION_MS, prefersReducedMotion } from "../utils/chartMotion";
import ControlBar from "./ControlBar";
import ChartMoreInfo from "./ChartMoreInfo";
import { METHOD_ANCHORS } from "./methodology/anchors";
import ConstituencyTable from "./ConstituencyTable";
import { shortNameOf } from "../utils/policyDetails";
import MeasureRowLabel from "./MeasureRowLabel";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import {
  buildRankingCsv,
  rankingEntries,
} from "../utils/constituencyRanking";
import { fitHexes } from "../utils/geography/hexLayout";
import UnavailableNotice from "./publication/UnavailableNotice";
import { useConstituencyView } from "../hooks/useConstituencyView";
import { CHART_LOGO } from "../utils/chartLogo";
import {
  buildMapSvg,
  exportMapAsSvg,
  MAP_ZOOM_LAYER_CLASS,
} from "../utils/exportMapAsSvg";
import { downloadFile, downloadSvg } from "../utils/downloadFile";
import { frameCsv, frameFileName, frameSvg } from "../utils/exportFrame";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import { htmlImageFormats } from "../utils/chartDownloads";
import {
  EXPORT_UNITS,
  buildCsv,
  formatGenerated,
} from "../utils/geography/exportTable";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { OUTCOME_LABELS, formatFigure } from "../utils/geography/format";
import {
  LEGEND_INSET,
  MAP_LEGEND_CLASS,
  appendStatusPatterns,
  drawMapLegend,
  placeMapLegend,
} from "../utils/geography/legend";
import {
  DIRECTION_TEXT_COLOURS,
  NO_DATA_FILL,
} from "../utils/geography/palette";
import {
  SCALE_GRADIENT,
  colourExtent,
  scaleColour,
  scaleLabels,
} from "../utils/geography/scale";
import { rowsFor } from "../utils/geography/rows";
import {
  cardLines,
  drawnAsNoData,
  seatCard,
  seatCode,
  seatName,
  seatStates,
  constituencySentence,
  seatStyle,
  seatSummary,
  unchangedLine,
} from "../utils/geography/seats";
import { choiceLabel, choiceMeasureNames } from "../utils/geography/selection";
import {
  REGION_VIEW_ID,
  areaViewsNotAvailable,
} from "../utils/geography/view";
import { fiscalYearLabel } from "../utils/publication/format";
import "./ConstituencyMap.css";
import { STACK_APPROXIMATE_NOTE } from "../utils/geography/stack";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { CHART_COLOURS } from "../utils/chartTheme";
import { FloatingTooltip } from "./FloatingTooltip";
import TitleIcon from "./TitleIcon";
import Tip, { InfoTip } from "./Tip";

const CHART_TITLE = "Constituency impacts";

// The card's three views, and the URL parameter that opens the second or
// third. The hex map is the default: every constituency the same size, so
// London's and the cities' small seats read as clearly as rural ones.
const PANELS = ["hex", "map", "table"];
const PANEL_PARAM = "map";
const PANEL_OPTIONS = [
  { value: "hex", label: "Hex map" },
  { value: "map", label: "Map" },
  { value: "table", label: "Table" },
];
// Links made before the Table view replaced the Rankings view
const LEGACY_PANELS = { rankings: "table" };

// Excel reads a CSV as UTF-8 only with a byte-order mark ("Ynys Môn").
const UTF8_BOM = "\uFEFF";

// Drill builds set NEXT_PUBLIC_MOCK=1; their numbers must never read as real.
const isMockBuild = () => process.env.NEXT_PUBLIC_MOCK === "1";

/**
 * The card's view, kept in the URL as ?map=map or ?map=table (the hex map,
 * the default, leaves the URL alone), as the sub-tabs keep theirs.
 */
function usePanelParam() {
  const [panel, setPanel] = useState(() => {
    if (typeof window === "undefined") return PANELS[0];
    const raw = new URLSearchParams(window.location.search).get(PANEL_PARAM);
    const value = LEGACY_PANELS[raw] ?? raw;
    return PANELS.includes(value) ? value : PANELS[0];
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (panel === PANELS[0]) params.delete(PANEL_PARAM);
    else params.set(PANEL_PARAM, panel);
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, "", url);
    }
  }, [panel]);
  return [panel, setPanel];
}

/** CSV text of every constituency's published row for a reform and year. */
function constituencyCsvText(table, { reform, year, yearLabel, packageChoice, label, names }) {
  if (!reform || !table) return null;
  const measures = packageChoice ? `${label}: ${names.join("; ")}` : label;
  return buildCsv(rowsFor(table, { reform, year }), [
    ["Generated", formatGenerated(new Date())],
    [packageChoice ? "Policies" : "Policy", measures],
    ["Reform", reform],
    ["Year", yearLabel],
    ["Units", EXPORT_UNITS],
    ["Source", "PolicyEngine UK Autumn Budget 2026 dashboard"],
  ]);
}

/**
 * How stacked figures are made, said once in About this chart (and in the
 * exported map's description): several policies with no combined run by
 * constituency (stack.js; Vahid, 28 October).
 */
export const STACK_ABOUT =
  "With several policies selected, each constituency's figure is the sum of each policy's own effect, " +
  "so interactions between policies are not included (nationally they come to under £1m a year). " +
  "Its 90% interval adds up the policies' own intervals, so it is wider than a combined estimate's would be. " +
  "A figure a policy withholds for confidentiality counts as zero, and the constituency's figure is then approximate.";

/** The exported map's description: what it shows, and how to read it. */
const exportDescription = (label, outcome, stacked = false) =>
  `${label}. Each constituency is coloured by the size of its average ` +
  `change in household net income, in ${OUTCOME_LABELS[outcome]}. Blank ` +
  "ones have no data: not published, to protect survey respondents' " +
  "confidentiality, or too few survey households to estimate. " +
  (stacked
    ? STACK_ABOUT
    : "Some figures are approximate, based on fewer than 30 survey households.");

/**
 * The card's "About this chart". Each rule is the generator's: the
 * disclosure layer's defaults (policyengine.disclosure DisclosureSettings,
 * which uk_budget_data.geography uses unchanged: min_sources 10,
 * max_top_share 0.5, min_rest_share 0.1, approximate_below_n_eff 30,
 * 1,000 bootstrap replicates, a 90% interval); classify.js's breaks are
 * in the key's tip (MapKey), not here.
 * `releaseKind` is the area routing's: which dataset the seats come from.
 */
export function constituencyInfo({ label, yearLabel, outcome, releaseKind, notRouted, stacked = false }) {
  const shows =
    `The average change in household net income in each of the 650 Westminster ` +
    `constituencies in ${yearLabel}, ${outcome === "average_change" ? "in £ a year per household" : "as a share of household income"}.` +
    (label ? ` Shown: ${label}.` : "");
  if (notRouted) return { shows };
  return {
    shows,
    how: [
      releaseKind === "area_coded_national"
        ? "Households in the national dataset (the enhanced Family Resources Survey) are reweighted to each constituency with 2025 constituency weights, scaled to each later year."
        : "Each survey household in PolicyEngine's local-area dataset belongs to one constituency; its figure is their weighted average.",
      "Each figure has a 90% interval from 1,000 bootstrap resamples of survey households.",
      // No data and approximate: said here once; the key has the No data swatch only
      "No data: the figure is not published, to protect survey respondents' confidentiality (under 10 survey households, or one or two would make up too much of it), or there are too few survey households to estimate it (its 90% interval spans more than two of the map's size bands); hover a constituency for its interval.",
      "Some figures are approximate, based on fewer than 30 survey households, so read them as a rough guide: they are coloured like the rest, and the constituency's card says so.",
      ...(stacked ? [STACK_ABOUT] : []),
    ],
    definitions: [
      { ref: "netIncome" },
      { term: "Hex map", meaning: "One equal hexagon per seat, placed roughly where it lies; shapes are not geographic." },
      { term: "Map", meaning: "Each seat's real boundary, so large rural seats dominate." },
      { term: "No data", meaning: "Not published, or too few survey households to estimate." },
    ],
    caveats: [
      "Survey weights are held fixed in the resampling, so the intervals understate the uncertainty.",
      "Constituency figures do not add up exactly to the regional ones, and may use a different dataset.",
    ],
    sources: [
      { label: "2024 Westminster constituency boundaries (650 seats)" },
      {
        label: "Hex layout: Open Innovations, UK constituencies 2024 HexJSON (CC BY 4.0)",
        href: "https://github.com/open-innovations/constituencies",
      },
    ],
    method: { anchor: METHOD_ANCHORS.area, label: "How the figures by area are estimated" },
  };
}

// The map's drawing area, in SVG units. The exported file shows all of it,
// with the SVG's legend in the top-left corner, so the seats are fitted to
// the right of the legend's column; on screen the viewBox is the seats' own
// box, so this space is never shown there.
const EXPORT_LEGEND_SPACE = 290;
const WIDTH = 800;
const HEIGHT = 600;
// The space kept round the map at its full fit, in SVG units
const FIT_PADDING = 12;

/** The smallest box holding every seat's box, with padding round it. */
function boxAround(boxes, padding = FIT_PADDING) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    if (!box) continue;
    const [[a, b], [c, d]] = box;
    if (![a, b, c, d].every(Number.isFinite)) continue;
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  return {
    x: x0 - padding,
    y: y0 - padding,
    width: x1 - x0 + 2 * padding,
    height: y1 - y0 + 2 * padding,
  };
}

const SELECTED_STROKE = { stroke: CHART_COLOURS.highlight, strokeWidth: 0.6 };
const HOVER_STROKE = { stroke: CHART_COLOURS.tick, strokeWidth: 0.3 };

// A colour d3 can blend: a hex value, or rgb() left by an interrupted
// transition. Never a pattern's url().
const isColour = (fill) =>
  typeof fill === "string" && (fill.startsWith("#") || fill.startsWith("rgb("));

/** A projection fitting British National Grid coordinates into the SVG. */
function gridProjection(features) {
  const bounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
  const visit = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      bounds.xMin = Math.min(bounds.xMin, coordinates[0]);
      bounds.xMax = Math.max(bounds.xMax, coordinates[0]);
      bounds.yMin = Math.min(bounds.yMin, coordinates[1]);
      bounds.yMax = Math.max(bounds.yMax, coordinates[1]);
    } else {
      coordinates.forEach(visit);
    }
  };
  features.forEach((feature) => {
    if (feature.geometry?.coordinates) visit(feature.geometry.coordinates);
  });
  const padding = 20;
  const dataWidth = bounds.xMax - bounds.xMin;
  const dataHeight = bounds.yMax - bounds.yMin;
  const scale = Math.min(
    (WIDTH - EXPORT_LEGEND_SPACE - 2 * padding) / dataWidth,
    (HEIGHT - 2 * padding) / dataHeight,
  );
  const offsetX = EXPORT_LEGEND_SPACE + (WIDTH - EXPORT_LEGEND_SPACE - dataWidth * scale) / 2;
  const offsetY = (HEIGHT - dataHeight * scale) / 2;
  return d3.geoTransform({
    point(x, y) {
      this.stream.point(
        (x - bounds.xMin) * scale + offsetX,
        HEIGHT - ((y - bounds.yMin) * scale + offsetY),
      );
    },
  });
}

/**
 * How the seats are drawn in a map view, in the 800 × 600 drawing area
 * either way, so zoom, reset, the textures and the export work alike:
 * "map", each seat's boundary; "hex", one equal hexagon per seat
 * (hexLayout.js). `pathFor` gives a seat's SVG path, `boundsOf` its box by
 * code, and `box` the box round them all, padded: the map's full fit,
 * Shetland included, which the SVG's viewBox shows and Reset returns to.
 */
export function seatGeometry(features, mode) {
  if (mode === "hex") {
    const { paths, bounds } = fitHexes(features.map(seatCode), {
      width: WIDTH,
      height: HEIGHT,
      left: EXPORT_LEGEND_SPACE,
    });
    return {
      mode,
      pathFor: (feature) => paths.get(seatCode(feature)) ?? null,
      boundsOf: (code) => bounds.get(code) ?? null,
      box: boxAround(bounds.values()),
    };
  }
  const path = d3.geoPath().projection(gridProjection(features));
  const byCode = new Map(features.map((feature) => [seatCode(feature), feature]));
  return {
    mode,
    pathFor: path,
    boundsOf: (code) => (byCode.has(code) ? path.bounds(byCode.get(code)) : null),
    box: boxAround(features.map((feature) => path.bounds(feature))),
  };
}

// The map key's one entry that highlights seats on hover: No data, beside
// the colour scale (Vahid, 28 October). Little change is on the scale, at
// its 0; not published, no row and too uncertain to place on the scale
// share the No data swatch (drawnAsNoData). Approximate figures are plain
// colour; the card and About this chart say so, with no chip.
export const NO_DATA_KEY = "no-data";
export const NO_DATA_DETAIL = "No data: not published, or too few survey households to estimate";
const STATUS_ENTRIES = [
  { key: NO_DATA_KEY, label: "No data", detail: NO_DATA_DETAIL, fill: NO_DATA_FILL },
];

/** Whether a seat's state matches a key entry (NO_DATA_KEY, "cat:small_gain", "kind:approximate"). */
export function matchesKey(state, key) {
  if (key === NO_DATA_KEY) return drawnAsNoData(state);
  const [type, value] = key.split(":");
  if (type === "cat") return state?.category === value;
  return (state?.kind ?? "no-data") === value;
}

/** How many seats match each key entry. */
export function keyCounts(states) {
  const counts = {};
  const keys = STATUS_ENTRIES.map((entry) => entry.key);
  for (const key of keys) counts[key] = 0;
  for (const state of states?.values() ?? []) {
    for (const key of keys) if (matchesKey(state, key)) counts[key] += 1;
  }
  return counts;
}

// Below this window width (a phone) the key sits under the map in rows;
// wider, it is a column beside the map, so the map takes the card's height
export const LEGEND_SIDE_MIN_WIDTH = 640;

/** Where the map's key goes at a window width: "side" or "below". */
export const legendPlacement = (width) =>
  Number.isFinite(width) && width < LEGEND_SIDE_MIN_WIDTH ? "below" : "side";

/** The key's place for the current window, following resizes. */
function useLegendPlacement() {
  const [placement, setPlacement] = useState(() =>
    typeof window === "undefined" ? "side" : legendPlacement(window.innerWidth),
  );
  useEffect(() => {
    const update = () => setPlacement(legendPlacement(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return placement;
}

// The scale's gradient in the side key: loss at the foot, gain at the top
const SCALE_GRADIENT_VERTICAL = SCALE_GRADIENT.replace("to right", "to top");

const seatCount = (n) => `${n.toLocaleString("en-GB")} ${n === 1 ? "seat" : "seats"}`;

/**
 * The map's key: a smooth gradient from a loss (amber) through no change
 * (light grey) to a gain (teal), labelled at its two ends and 0, and
 * one compact No data chip. Beside the map (`placement` "side") the
 * gradient stands upright, gain at the top, with a tick at each label, and
 * the chip is under it; on a phone ("below") it is the horizontal row
 * under the map. Hovering or focusing the chip highlights the seats it
 * covers (`onHighlight`) and gives their number beside the chip, out of
 * the flow, so hovering never moves anything.
 */
function MapKey({ outcome, extent, counts, highlight, onHighlight, placement = "below" }) {
  const [low, zero, high] = scaleLabels(outcome, extent);
  const title = `Change in household net income, ${OUTCOME_LABELS[outcome]}`;
  const lastSpace = title.lastIndexOf(" ");
  const [titleStart, titleEnd] = [title.slice(0, lastSpace), title.slice(lastSpace + 1)];
  const hovered = highlight ? counts[highlight] : null;
  const entryProps = (key, label) => ({
    type: "button",
    "data-key": key,
    "aria-label": `${label}: ${seatCount(counts[key] ?? 0)}`,
    "aria-pressed": highlight === key,
    onMouseEnter: () => onHighlight(key),
    onMouseLeave: () => onHighlight(null),
    onFocus: () => onHighlight(key),
    onBlur: () => onHighlight(null),
  });
  const swatch = (entry) => (
    <svg className="map-key-swatch" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      {entry.halves ? (
        entry.halves.map((fill, half) => <rect key={half} x={half * 6} y="0" width="6" height="12" fill={fill} />)
      ) : (
        <rect width="12" height="12" fill={entry.fill} />
      )}
      <rect x="0.25" y="0.25" width="11.5" height="11.5" fill="none" stroke={entry.stroke ?? CHART_COLOURS.axis} strokeWidth="0.5" />
    </svg>
  );
  return (
    <div
      className={`map-key map-key-${placement}${highlight ? " is-highlighting" : ""}`}
      role="group"
      aria-label="Key"
    >
      <div className="map-key-head">
        {/* The ⓘ ends the title's last line, wrapping with its last word
            (never alone on a line of its own) */}
        <p className="map-key-title">
          {titleStart}{" "}
          <span className="nowrap map-key-title-end">
            {titleEnd}
            <InfoTip
              label="How to read the key"
              content={
                `Amber is a loss, light grey little or no change and teal a gain, on one scale from ${low} to ${high} ` +
                "for every policy and year (larger changes take the end colours). No data: not published, or too few survey households to estimate. " +
                "About this chart says more."
              }
            />
          </span>
        </p>
      </div>
      <div className="map-key-scale">
        <div
          className="map-key-gradient"
          role="img"
          aria-label={`Colour scale from ${low} (amber) through ${zero} (grey) to ${high} (teal)`}
          style={{ background: placement === "side" ? SCALE_GRADIENT_VERTICAL : SCALE_GRADIENT }}
        />
        <div className="map-key-labels" aria-hidden="true">
          <span>{low}</span>
          <span>{zero}</span>
          <span>{high}</span>
        </div>
      </div>
      <div className="map-key-statuses">
        {STATUS_ENTRIES.map((entry) => (
          <button
            key={entry.key}
            className={`map-key-item${highlight === entry.key ? " is-active" : ""}`}
            {...entryProps(entry.key, entry.detail ?? entry.label)}
          >
            {swatch(entry)}
            <span>{entry.label}</span>
          </button>
        ))}
        {/* The hovered entry's seat count, beside the chip and out of the
            flow, so it appearing never moves the key, the chip under the
            pointer or the map (Vahid, 28 October: "it changes the position") */}
        <span className="map-key-count" aria-live="polite">
          {hovered !== null && hovered !== undefined ? seatCount(hovered) : ""}
        </span>
      </div>
    </div>
  );
}

function strokeFor(code, states, selectedCode) {
  if (code === selectedCode) return SELECTED_STROKE;
  return seatStyle(states?.get(code));
}

/** A figure's text colour by its sign: teal for a gain, amber for a loss, else grey. */
const signColour = (sign) => DIRECTION_TEXT_COLOURS[sign] ?? CHART_COLOURS.axisTitle;

/**
 * One seat's card: the figure for what the map shows (one measure, or the
 * package), in £ and as a share of income on one line, labelled with what
 * it is; then the rest of the selection's own £ changes, largest first,
 * each with a small bar to scale; then one muted line on how firm the
 * figure is. The hover card and the pinned card (with its ×) are the same.
 */
function SeatCard({ card }) {
  const { byId } = useMeasureCatalogue();
  const largest = Math.max(0, ...card.byPolicy.map((row) => Math.abs(row.value ?? 0)));
  return (
    <>
      {(card.average || card.relative) && (
        <div className="seat-card-figure">
          <p className="seat-card-headline">
            {card.average && (
              <span className="seat-card-value" style={{ color: signColour(card.average.sign) }}>
                {card.average.text}
              </span>
            )}
            {card.average && card.relative && <span className="seat-card-dot" aria-hidden="true"> · </span>}
            {card.relative && (
              <span className="seat-card-value seat-card-value-secondary" style={{ color: signColour(card.relative.sign) }}>
                {card.relative.text}
                <span className="seat-card-unit"> of income</span>
              </span>
            )}
          </p>
          <p className="seat-card-label">{card.label ?? "Average household impact"}</p>
        </div>
      )}
      {card.policiesHeading && (
        <div className="seat-card-policies">
          <p className="seat-card-policies-heading">{card.policiesHeading}</p>
          {card.byPolicy.map((row) => (
            <div key={row.id} className="seat-card-policy">
              <MeasureRowLabel tip={false} measure={byId?.get(row.id) ?? { id: row.id, name: row.name }} name={row.name} nameClassName="seat-card-policy-name" />
              {row.value !== null && (
                <span className="seat-card-policy-bar" aria-hidden="true">
                  {largest > 0 && (
                    <span
                      style={{
                        width: `${Math.max(4, (Math.abs(row.value) / largest) * 100)}%`,
                        background: signColour(row.sign),
                      }}
                    />
                  )}
                </span>
              )}
              {row.value === null ? (
                <Tip content={row.title}>
                  <span className="seat-card-policy-value seat-card-withheld" tabIndex={0}>
                    {row.text}
                  </span>
                </Tip>
              ) : (
                <span className="seat-card-policy-value" style={{ color: signColour(row.sign) }}>
                  {row.text}
                </span>
              )}
            </div>
          ))}
          {card.unchanged.length > 0 && (
            <Tip content={card.unchanged.join(", ")}>
              <p className="seat-card-unchanged" tabIndex={0}>
                {unchangedLine(card.unchanged.length)}
              </p>
            </Tip>
          )}
        </div>
      )}
      {card.note && (
        <p className={card.average || card.relative ? "seat-card-note" : "seat-card-status"}>{card.note}</p>
      )}
      {card.region && <p className="seat-card-region">{card.region}</p>}
    </>
  );
}

// The pinned card's gap from the seat, which the map centres
const CARD_GAP = 10;

/**
 * Constituency results as the disclosure layer published them, for one
 * measure or the whole package, one outcome and one year; for several
 * policies with no combined run, the sum of their own rows (stack.js).
 * Seats are coloured on the scale (approximate ones too), and drawn as no
 * data when withheld, too uncertain to place on the scale, or with no
 * row. It draws only on a
 * release that says it routes results by area: on one that routes none it
 * says so, and when it can't read the release's routing it says its results
 * could not be loaded, drawing nothing either way.
 */
/**
 * The map's layout before its results are published: every constituency
 * drawn in neutral grey from the boundaries the site ships, a disabled
 * search box, the colour scale without values, and the notice over the
 * map. Without the boundaries, the notice alone. The notice keeps one place
 * in the tree either way, so it is not remounted when the boundaries load.
 */
function MapTemplate({ features, mode = "map", children }) {
  const paths = useMemo(() => {
    if (!features?.length) return null;
    const { pathFor } = seatGeometry(features, mode);
    return features.map((feature) => ({ code: seatCode(feature), d: pathFor(feature) }));
  }, [features, mode]);
  return (
    <div className={`map-template ${paths ? "" : "map-template-empty"}`}>
      <div className="map-template-canvas">
        {paths && (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            className="map-template-svg"
          >
            {paths.map(({ code, d }) => (
              <path key={code} d={d} fill={CHART_COLOURS.axis} stroke={CHART_COLOURS.surface} strokeWidth={0.4} />
            ))}
          </svg>
        )}
        <div className="map-template-overlay">{children}</div>
      </div>
    </div>
  );
}

/** The map's colour scale, from losses to gains, without values. */
function MapScalePlaceholder() {
  return (
    <div className="map-scale-placeholder" aria-hidden="true">
      <span className="map-scale-gradient" style={{ background: SCALE_GRADIENT }} />
    </div>
  );
}

export default function ConstituencyMap({
  selectedPolicies = [],
  selectedYear = DEFAULT_DISPLAY_YEAR,
  policies = [],
  // Whether the page shows the results by region, so a notice can link
  // to them.
  showRegionLink = true,
}) {
  const [outcome, setOutcome] = useState("relative_change");
  const [panel, setPanelParam] = usePanelParam();
  // The map view drawn: the one shown, or in the Table view the last one
  // shown, kept mounted so it keeps its zoom
  const [mapMode, setMapMode] = useState(panel === "map" ? "map" : "hex");
  const setPanel = useCallback(
    (next) => {
      setPanelParam(next);
      if (next !== "table") setMapMode(next);
    },
    [setPanelParam],
  );
  const legendPlace = useLegendPlacement();
  const [selectedCode, setSelectedCode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [svgNode, setSvgNode] = useState(null);
  const mapRef = useRef(null);
  const selectedRef = useRef(null);
  const statesRef = useRef(null);
  // The seat under the pointer and where, in the map canvas
  const canvasRef = useRef(null);
  const [hoverSeat, setHoverSeat] = useState(null);

  // The map and the rankings read one state (useConstituencyView), so they
  // have figures together, from the same rows, under the same gate.
  const {
    view,
    choice,
    table: constituencyTable,
    regionalTable,
    features,
    boundariesReady,
    routing,
    regionalHasChoice,
  } = useConstituencyView({ selectedPolicies, policies, selectedYear, outcome });
  const policyName = (id) => shortNameOf(policies.find((policy) => policy.id === id) ?? { id });
  // On a release that routes no results by area, the card describes the
  // measure only, not how to read a map it does not draw.
  const notRouted = areaViewsNotAvailable(routing);
  const reform = view.kind === "rows" ? view.reform : null;
  const label = choiceLabel(choice, policies);
  // Several policies, with no combined run by constituency: each seat's
  // figure is the sum of their own (stack.js)
  const stacked = choice.kind === "stack";
  const several = choice.kind === "package" || stacked;
  // What the title names: the one policy shown, or the selection
  const titleSubject =
    choice.kind === "measure"
      ? policyName(choice.reform)
      : several || choice.kind === "no-package"
        ? "selected policies"
        : null;
  const yearLabel = fiscalYearLabel(selectedYear);
  // A hover from another year, measure or outcome is not shown, so the
  // tooltip never shows the figures it had while the year pill plays
  const hoverStamp = `${selectedYear}|${reform}|${outcome}`;
  const hoverStampRef = useRef(hoverStamp);
  useEffect(() => {
    hoverStampRef.current = hoverStamp;
  }, [hoverStamp]);

  const states = useMemo(
    () =>
      reform && features
        ? seatStates(features, constituencyTable, {
            reform,
            year: selectedYear,
            outcome,
          })
        : null,
    [features, constituencyTable, reform, selectedYear, outcome],
  );

  // The colour scale's half-width: fixed in advance, the same for every
  // selection, year and policy (scale.js)
  const colourDomain = colourExtent(outcome);

  // The Table view: every seat's figures for the reform and year, ranked
  // by the outcome the map shows.
  const metric = outcome === "average_change" ? "gbp" : "pct";
  const rankingEntriesForView = useMemo(
    () => rankingEntries(features, constituencyTable, { reform, year: selectedYear }),
    [features, constituencyTable, reform, selectedYear],
  );
  const tableReady = Boolean(reform) && rankingEntriesForView.length > 0;

  // The seats' shapes in the map view drawn
  const geometry = useMemo(
    () => (features ? seatGeometry(features, mapMode) : null),
    [features, mapMode],
  );

  const featuresByCode = useMemo(
    () => new Map((features ?? []).map((feature) => [seatCode(feature), feature])),
    [features],
  );

  // Keep the latest selection and states where d3's handlers can read them.
  useEffect(() => {
    selectedRef.current = selectedCode;
    statesRef.current = states;
  }, [selectedCode, states]);

  const applyStrokes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.layer.selectAll("path.constituency-path").each(function (feature) {
      const { stroke, strokeWidth } = strokeFor(
        seatCode(feature),
        statesRef.current,
        selectedRef.current,
      );
      d3.select(this).attr("stroke", stroke).attr("stroke-width", strokeWidth);
    });
  }, []);

  const zoomToSeat = useCallback(
    (code) => {
      const map = mapRef.current;
      const seatBox = map?.geometry.boundsOf(code);
      if (!map || !seatBox) return;
      const [[x0, y0], [x1, y1]] = seatBox;
      const scale = Math.max(
        1,
        Math.min(
        4,
        0.9 /
          Math.max(
            (x1 - x0) / map.geometry.box.width,
            (y1 - y0) / map.geometry.box.height,
          ),
      ),
      );
      const x = (x0 + x1) / 2;
      const y = (y0 + y1) / 2;
      const { box } = map.geometry;
      map.svg
        .transition()
        .duration(750)
        .call(
          map.zoom.transform,
          d3.zoomIdentity
            .translate(box.x + box.width / 2 - scale * x, box.y + box.height / 2 - scale * y)
            .scale(scale),
        );
    },
    [],
  );

  const selectSeat = useCallback(
    (code) => {
      selectedRef.current = code;
      setSelectedCode(code);
      applyStrokes();
      zoomToSeat(code);
    },
    [applyStrokes, zoomToSeat],
  );

  const clearSelection = useCallback(() => {
    selectedRef.current = null;
    setSelectedCode(null);
    applyStrokes();
  }, [applyStrokes]);

  // Draw the seats, the status textures, the legend's place and the logo
  // once per set of boundaries. Colours are applied separately below.
  useEffect(() => {
    if (!svgNode || !features || !geometry) return undefined;
    const svg = d3.select(svgNode);
    svg.selectAll("*").remove();
    svg.attr("data-view", geometry.mode);
    appendStatusPatterns(svg.append("defs"));
    const layer = svg.append("g").attr("class", MAP_ZOOM_LAYER_CLASS);
    layer
      .selectAll("path")
      .data(features, seatCode)
      .join("path")
      .attr("class", "constituency-path")
      .attr("data-code", seatCode)
      .attr("d", geometry.pathFor)
      .style("cursor", "pointer");
    // The legend is for the exported file, which shows the whole drawing
    // area with the legend in its corner; on screen the key is HTML
    // (MapKey), so this one is never drawn there, even before the
    // stylesheet loads (the export takes the attribute off)
    placeMapLegend(svg.append("g").attr("class", MAP_LEGEND_CLASS).attr("display", "none").attr("aria-hidden", "true"), {
      x: LEGEND_INSET,
      y: LEGEND_INSET,
    });
    const { box } = geometry;
    const zoom = d3
      .zoom()
      .scaleExtent([1, 8])
      .extent([
        [box.x, box.y],
        [box.x + box.width, box.y + box.height],
      ])
      .on("zoom", (event) => layer.attr("transform", event.transform));
    svg.call(zoom);
    mapRef.current = { svg, layer, geometry, zoom };
    // A seat still selected from before the map was redrawn is centred
    // again, where its tooltip sits.
    if (selectedRef.current) zoomToSeat(selectedRef.current);
    return () => {
      svg.interrupt();
      layer.selectAll("path").interrupt();
      svg.on(".zoom", null);
      mapRef.current = null;
    };
  }, [svgNode, features, geometry, zoomToSeat]);

  // Colour the seats, draw the legend and attach the handlers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !states) return;
    const seats = map.layer.selectAll("path.constituency-path");
    const extent = colourDomain;
    const colourOf = (value) => scaleColour(value, extent);
    seats.each(function (feature) {
      const node = d3.select(this);
      const style = seatStyle(states.get(seatCode(feature)), colourOf);
      const previous = node.attr("fill");
      node.interrupt();
      node.attr("fill-opacity", style.fillOpacity);
      node.attr("data-state", states.get(seatCode(feature))?.kind ?? "no-data");
      // A pattern's url() cannot be blended with a colour, so only a
      // change from one colour to another is animated.
      if (isColour(previous) && isColour(style.fill) && previous !== style.fill && !prefersReducedMotion()) {
        const blend = d3.interpolateRgb(previous, style.fill);
        // Ends on the colour exactly as written, not as rgb().
        node
          .transition()
          .duration(CHART_MOTION_MS)
          .ease(d3.easeCubicOut)
          .attrTween("fill", () => (t) => (t < 1 ? blend(t) : style.fill));
      } else {
        node.attr("fill", style.fill);
      }
    });
    applyStrokes();
    drawMapLegend(map.svg.select(`g.${MAP_LEGEND_CLASS}`), { outcome, extent });
    seats
      .on("click", (event, feature) => {
        event.stopPropagation();
        selectSeat(seatCode(feature));
      })
      .on("mouseover mousemove", function (event, feature) {
        const box = canvasRef.current?.getBoundingClientRect();
        if (box) {
          setHoverSeat({
            stamp: hoverStampRef.current,
            code: seatCode(feature),
            x: event.clientX - box.left,
            y: event.clientY - box.top,
          });
        }
        if (seatCode(feature) === selectedRef.current) return;
        d3.select(this)
          .attr("stroke", HOVER_STROKE.stroke)
          .attr("stroke-width", HOVER_STROKE.strokeWidth);
      })
      .on("mouseout", function (event, feature) {
        setHoverSeat(null);
        const { stroke, strokeWidth } = strokeFor(
          seatCode(feature),
          statesRef.current,
          selectedRef.current,
        );
        d3.select(this).attr("stroke", stroke).attr("stroke-width", strokeWidth);
      });
  }, [svgNode, features, geometry, states, outcome, colourDomain, applyStrokes, selectSeat]);

  // The key entry hovered: the seats it covers stand out, the rest fade
  // (a style on the page only; the exported file never carries it)
  const [keyHighlight, setKeyHighlight] = useState(null);
  const counts = useMemo(() => keyCounts(states), [states]);
  // The card's one sentence under its title, from the rows the map
  // colours; when every seat is zero or withheld it says so, so the map's
  // grey and blank seats are not left to explain themselves
  const sentence = useMemo(
    () =>
      view.kind === "rows"
        ? constituencySentence(states, {
            outcome,
            yearLabel,
            several,
            // Always which policy it describes, when it is one
            policy: choice.kind === "measure" ? policyName(choice.reform) : null,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.kind, states, outcome, yearLabel, choice.kind, choice.reform, several],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.layer.selectAll("path.constituency-path").each(function (feature) {
      const dim = keyHighlight !== null && !matchesKey(states?.get(seatCode(feature)), keyHighlight);
      if (dim) this.setAttribute("data-dim", "true");
      else this.removeAttribute("data-dim");
    });
  }, [keyHighlight, states, geometry, svgNode]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !features || !states) return [];
    return features
      .map((feature) => {
        const state = states.get(seatCode(feature));
        return {
          code: seatCode(feature),
          name: seatName(feature, state?.row),
          summary: seatSummary(state),
        };
      })
      .filter((seat) => seat.name.toLowerCase().includes(query))
      .slice(0, 5);
  }, [searchQuery, features, states]);

  // The selected measures with their short names, in the page's order,
  // for each card's By policy rows
  const cardMeasures = useMemo(
    () =>
      policies
        .filter((policy) => selectedPolicies.includes(policy.id))
        .map((policy) => ({ id: policy.id, name: shortNameOf(policy) })),
    [policies, selectedPolicies],
  );
  const cardFor = (code) =>
    states && featuresByCode.get(code)
      ? seatCard({
          feature: featuresByCode.get(code),
          state: states.get(code),
          table: constituencyTable,
          regional: regionalTable,
          reform,
          year: selectedYear,
          outcome,
          measures: cardMeasures,
          label: several
            ? `${choice.all ? "All policies" : "Selected policies"}${stacked ? ", each policy's effect added up" : ""}`
            : null,
        })
      : null;
  const card = selectedCode ? cardFor(selectedCode) : null;
  // The selected seat's card as lines, for the exported map
  const tooltip = card ? cardLines(card) : null;

  // The hovered seat's card, from the current rows (never another
  // year's), unless it is the selected seat, whose card is open
  const hoverCard =
    hoverSeat && hoverSeat.stamp === hoverStamp && hoverSeat.code !== selectedCode
      ? cardFor(hoverSeat.code)
      : null;
  const hoverTip = hoverCard
    ? {
        key: hoverSeat.code,
        x: hoverSeat.x,
        y: hoverSeat.y,
        content: (
          <div className="chart-tooltip seat-card seat-card-hover">
            <p className="seat-card-title">{hoverCard.title}</p>
            <SeatCard card={hoverCard} />
          </div>
        ),
      }
    : null;

  // The pinned card sits just above the seat the map centres, moved down
  // and across as needed so it stays inside the map (and so on screen)
  const cardRef = useRef(null);
  // The Table view's panel, for its image downloads
  const [rankingsPanel, setRankingsPanel] = useState(null);
  const closeRef = useRef(null);
  const [cardPlace, setCardPlace] = useState(null);
  useLayoutEffect(() => {
    const node = cardRef.current;
    const canvas = canvasRef.current;
    if (!node || !canvas) {
      setCardPlace(null);
      return;
    }
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const maxX = Math.max(0, canvasWidth - width);
    const maxY = Math.max(0, canvasHeight - height);
    const left = Math.min(Math.max(0, canvasWidth / 2 - width / 2), maxX);
    let top = canvasHeight / 2 - CARD_GAP - height;
    if (top < 0) top = canvasHeight / 2 + CARD_GAP;
    setCardPlace({ left, top: Math.min(Math.max(0, top), maxY), maxHeight: canvasHeight });
  }, [card?.title, card?.byPolicy.length, card?.unchanged.length, card?.note, card?.region, selectedCode]);

  // Escape closes the pinned card
  useEffect(() => {
    if (!selectedCode) return undefined;
    const close = (event) => {
      if (event.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedCode, clearSelection]);

  const handleZoom = (factor) => {
    const map = mapRef.current;
    if (map) map.svg.transition().duration(300).call(map.zoom.scaleBy, factor);
  };

  const handleResetZoom = () => {
    const map = mapRef.current;
    if (map) {
      map.svg.transition().duration(750).call(map.zoom.transform, d3.zoomIdentity);
    }
    clearSelection();
  };

  const exportName = `constituency-map-${reform}-${outcome}-${selectedYear}`;
  // Built when a download runs, as the SVG export always was.
  const exportOptions = () => ({
    title: `${CHART_TITLE}, ${yearLabel}`,
    description: exportDescription(label, outcome, stacked),
    logo: CHART_LOGO,
    tooltip,
  });
  // The file's frame (title, Options, source, date) comes from the
  // download menu; the map names what it shows (a measure, or the package)
  // in place of the band's selection.
  const mapFrame = (frame) =>
    frame && {
      ...frame,
      policies: label || frame.policies,
      subtitle: [label || frame.policies, frame.selection].filter(Boolean).join(" · "),
    };
  const framedMap = async (frame) => {
    const framed = mapFrame(frame);
    // Framed, the frame draws the title and logo; the builder the map alone
    const options = framed ? { tooltip } : exportOptions();
    return framed
      ? frameSvg(await buildMapSvg(svgNode, options), framed, { logo: CHART_LOGO })
      : buildMapSvg(svgNode, options);
  };
  const handleExportSvg = async (frame) => {
    if (!svgNode) return;
    if (!frame) {
      await exportMapAsSvg(svgNode, exportName, exportOptions());
      return;
    }
    const built = await framedMap(frame);
    if (built) downloadSvg(built.svg, frameFileName(frame, exportName));
  };
  // The CSV holds the published strings for every constituency, as the
  // region export does: withheld figures stay blank.
  const handleExportCsv = (frame) => {
    const text = constituencyCsvText(constituencyTable, {
      reform,
      year: selectedYear,
      yearLabel,
      packageChoice: several,
      label,
      names: choiceMeasureNames(choice, policies),
    });
    if (text) {
      downloadFile(
        frameCsv(text, mapFrame(frame)),
        `${frame ? frameFileName(frame, "constituency-results") : `constituency-results-${reform}-${selectedYear}`}.csv`,
        "text/csv;charset=utf-8",
      );
    }
  };
  const mapDownloads = {
    csv: handleExportCsv,
    png: async (frame) => {
      if (!svgNode) return;
      await downloadSvgAsPng(await framedMap(frame), frameFileName(frame, exportName));
    },
    svg: handleExportSvg,
  };
  // The Table view's CSV: every constituency on the map, ranked.
  const handleExportRankings = () => {
    const mock = isMockBuild();
    const text = buildRankingCsv(rankingEntriesForView, {
      metric,
      year: selectedYear,
      yearLabel,
      measures: choiceMeasureNames(choice, policies),
      mock,
    });
    downloadFile(
      `${UTF8_BOM}${text}`,
      `${mock ? "MOCK-" : ""}constituency-rankings-${reform}-${selectedYear}-by-${metric}.csv`,
      "text/csv;charset=utf-8",
    );
  };
  const onMap = panel !== "table";
  // The map's full fit: the box round every seat in the view drawn
  const fit = geometry?.box ?? { x: 0, y: 0, width: WIDTH, height: HEIGHT };
  const downloadsReady = onMap ? view.kind === "rows" : tableReady;
  // The Table view: its CSV, and the table as the page shows it as images
  // (chartDownloads), so both views offer the same formats
  const downloads = onMap
    ? mapDownloads
    : { csv: handleExportRankings, ...htmlImageFormats(() => rankingsPanel, `constituency-rankings-${reform}-${selectedYear}-by-${metric}`) };
  const notice =
    view.kind === "notice" ? (
      <UnavailableNotice reason={view.reason}>
        {regionalHasChoice && showRegionLink && (
          <p>
            <a href={`#${REGION_VIEW_ID}`}>See the results by region.</a>
          </p>
        )}
      </UnavailableNotice>
    ) : null;

  // The card's choices: how the change is shown, and the view. The
  // policies are the header's selection, stacked when there are several
  // (Vahid, 28 October), so the card has no Policy choice of its own
  const optionGroups = [
    {
      label: "Show the change as",
      value: outcome,
      onChange: setOutcome,
      options: ["relative_change", "average_change"].map((value) => ({
        value,
        label: OUTCOME_LABELS[value],
      })),
    },
    {
      label: "View",
      value: panel,
      onChange: setPanel,
      options: PANEL_OPTIONS,
    },
  ];
  const searchReady = view.kind === "rows";
  const searchPlaceholder = onMap
    ? "Search or select a constituency"
    : "Search by constituency or region";

  return (
    <div className="constituency-map-wrapper">
      <div className="map-header">
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="map" />
              <span className="title-text">
                {CHART_TITLE}, <span className="nowrap">{yearLabel}</span>
                {titleSubject && <span className="map-title-focus">: {titleSubject}</span>}
              </span>
            </h3>
            {/* One plain sentence from the map's figures, as the other
                cards have; how to read the map is in About this chart. A
                release that routes no results by area gets a line
                describing the measure only */}
            {notRouted ? (
              <p className="chart-description">
                Average change in household net income by constituency.
              </p>
            ) : (
              // One paragraph: the figures only
              sentence && <p className="chart-description">{sentence}</p>
            )}
          </div>
          {downloadsReady ? (
            <ChartDownloadMenu
              key={panel}
              formats={downloads}
              chartTitle={`${CHART_TITLE}, ${yearLabel}`}
            />
          ) : (
            <ChartDownloadMenu
              formats={{}}
              chartTitle={`${CHART_TITLE}, ${yearLabel}`}
              disabledReason="Available when results are published"
            />
          )}
        </div>
      </div>

      {/* Rows shared with the card beside it: controls, plot, legend,
          then the logo. */}
      <div className="chart-controls">
        {/* The same row in every view: the Options pill (how the change
            is shown, and the view) and the search box, which picks a seat
            on a map and filters the table */}
        <div className="map-top-bar">
          <ControlBar name={CHART_TITLE} options={optionGroups} />
          <div className="map-search-section">
            <div className="search-container">
              <input
                id="constituency-search"
                type="search"
                aria-label={searchPlaceholder}
                value={searchReady ? searchQuery : ""}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="constituency-search"
                autoComplete="off"
                disabled={!searchReady}
              />
              {onMap && searchReady && searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((result) => (
                    <button
                      key={result.code}
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        selectSeat(result.code);
                        // From the keyboard, focus moves to the card
                        requestAnimationFrame(() => closeRef.current?.focus());
                      }}
                      className="search-result-item"
                    >
                      <div className="result-name">{result.name}</div>
                      <div className="result-value">{result.summary}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SwapTransition swapKey={panel} className="chart-plot constituency-body">
        {view.kind === "loading" && (
          <PlotSkeleton className="constituency-loading" label="Loading map…" height={400} />
        )}

        {/* The one notice, over whichever view is shown */}
        {view.kind === "notice" && onMap && (
          <MapTemplate features={boundariesReady ? features : null} mode={panel}>
            {notice}
          </MapTemplate>
        )}

        {/* Before results are in, the Table view is the notice alone: no
            empty table, count or "no match" line behind it */}
        {!onMap && view.kind === "rows" && (
          <div ref={setRankingsPanel} className="rankings-panel">
            <ConstituencyTable
              entries={rankingEntriesForView}
              metric={metric}
              query={searchQuery}
              approximateNote={stacked ? STACK_APPROXIMATE_NOTE : undefined}
            />
          </div>
        )}
        {!onMap && view.kind === "notice" && <div className="rankings-panel rankings-panel-notice">{notice}</div>}

        {/* Kept mounted in the Table view, so the map keeps its zoom */}
        {view.kind === "rows" && (
          <div className={`map-content is-legend-${legendPlace}`} hidden={!onMap}>
            <MapKey
              placement={legendPlace}
              outcome={outcome}
              extent={colourDomain}
              counts={counts}
              highlight={keyHighlight}
              onHighlight={setKeyHighlight}
            />
            <div className="map-canvas" ref={canvasRef}>
              <svg
                ref={setSvgNode}
                width={fit.width}
                height={fit.height}
                viewBox={`${fit.x} ${fit.y} ${fit.width} ${fit.height}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`${mapMode === "hex" ? "Hex map" : "Map"} of ${CHART_TITLE.toLowerCase()}, ${label}, ${yearLabel}`}
                onClick={clearSelection}
              />

              <div
                className="map-controls-container"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="zoom-controls">
                  <Tip content="Zoom in">
                  <button
                    className="zoom-control-btn"
                    onClick={() => handleZoom(1.5)}
                    aria-label="Zoom in"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M10 7V13M7 10H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M15 15L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  </Tip>
                  <Tip content="Zoom out">
                  <button
                    className="zoom-control-btn"
                    onClick={() => handleZoom(0.67)}
                    aria-label="Zoom out"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M7 10H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M15 15L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  </Tip>
                  <Tip content="Reset zoom">
                  <button
                    className="zoom-control-btn"
                    onClick={handleResetZoom}
                    aria-label="Reset zoom"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M21 3V8H16"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  </Tip>
                </div>
              </div>

              {card && (
                <div
                  ref={cardRef}
                  className="constituency-tooltip seat-card"
                  role="dialog"
                  aria-label={`${card.title}, ${yearLabel}`}
                  aria-live="polite"
                  style={{
                    left: cardPlace?.left ?? 0,
                    top: cardPlace?.top ?? 0,
                    maxHeight: cardPlace?.maxHeight,
                    visibility: cardPlace ? "visible" : "hidden",
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    ref={closeRef}
                    type="button"
                    className="tooltip-close"
                    aria-label="Close"
                    onClick={clearSelection}
                  >
                    ×
                  </button>
                  <h4>{card.title}</h4>
                  <SeatCard card={card} />
                </div>
              )}
              <FloatingTooltip tip={hoverTip} />
            </div>
          </div>
        )}
      </SwapTransition>

      <div className="chart-legend">
        {/* While the results load, the scale without values (kept, unseen,
            in the Table view, so the card keeps its height). With no
            results to show, no scale: a key with nothing to read */}
        {view.kind === "loading" && (
          <div style={{ visibility: onMap ? "visible" : "hidden" }}>
            <MapScalePlaceholder />
          </div>
        )}
      </div>

      <div className="chart-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CHART_LOGO.href} alt="PolicyEngine" />
      </div>

      <div className="chart-footer">
        <ChartMoreInfo
          year={selectedYear}
          info={constituencyInfo({
            label,
            yearLabel,
            outcome,
            releaseKind: routing?.routing?.regionalReleaseKind,
            notRouted,
            stacked,
          })}
        />
      </div>

    </div>
  );
}
