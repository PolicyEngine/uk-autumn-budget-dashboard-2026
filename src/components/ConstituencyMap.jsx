import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import OutcomeToggle from "./OutcomeToggle";
import ViewSwitch, { ListIcon, MapIcon } from "./ViewSwitch";
import ConstituencyRankings, { TABLE_SIZE } from "./ConstituencyRankings";
import {
  APPROXIMATE_MARK,
  APPROXIMATE_NOTE,
  isApproximate,
} from "./ConstituencyRankingTable";
import {
  buildRankingCsv,
  rankConstituencies,
  rankingEntries,
  selectTopAndBottom,
} from "../utils/constituencyRanking";
import UnavailableNotice from "./publication/UnavailableNotice";
import { useConstituencyView } from "../hooks/useConstituencyView";
import { CHART_LOGO } from "../utils/chartLogo";
import {
  buildMapSvg,
  exportMapAsSvg,
  MAP_ZOOM_LAYER_CLASS,
} from "../utils/exportMapAsSvg";
import { downloadFile } from "../utils/downloadFile";
import { downloadSvgAsPng } from "../utils/rasteriseSvg";
import {
  EXPORT_UNITS,
  buildCsv,
  formatGenerated,
} from "../utils/geography/exportTable";
import ChartDownloadMenu from "./ChartDownloadMenu";
import { OUTCOME_LABELS } from "../utils/geography/format";
import {
  LEGEND_INSET,
  MAP_LEGEND_CLASS,
  appendStatusPatterns,
  drawMapLegend,
  placeMapLegend,
} from "../utils/geography/legend";
import {
  CATEGORY_COLOURS,
  DIRECTION_TEXT_COLOURS,
} from "../utils/geography/palette";
import { rowsFor } from "../utils/geography/rows";
import {
  describeSeat,
  seatCode,
  seatName,
  seatStates,
  seatStyle,
  seatSummary,
} from "../utils/geography/seats";
import {
  choiceLabel,
  choiceMeasureNames,
} from "../utils/geography/selection";
import {
  REGION_VIEW_ID,
  areaViewsNotAvailable,
} from "../utils/geography/view";
import { fiscalYearLabel } from "../utils/publication/format";
import "./ConstituencyMap.css";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import { CHART_COLOURS } from "../utils/chartTheme";
import { FloatingTooltip, TooltipRows } from "./FloatingTooltip";
import TitleIcon from "./TitleIcon";

/**
 * A hovered seat's tooltip rows from describeSeat's lines: the figure under
 * its outcome's name and the 90% interval, or for a seat with no figure,
 * its notes.
 */
export function seatTooltipRows(described) {
  const value = described.lines.find((line) => line.kind === "value");
  const name = described.lines.find((line) => line.kind === "label");
  const interval = described.lines.find((line) => line.kind === "interval");
  if (!value) {
    return described.lines.map((line, index) => ({
      key: `note-${index}`,
      name: line.text,
      text: "",
      color: CHART_COLOURS.noChange,
    }));
  }
  const color =
    value.direction === "gain"
      ? CHART_COLOURS.gain
      : value.direction === "loss"
        ? CHART_COLOURS.loss
        : CHART_COLOURS.noChange;
  return [
    { key: "value", name: name?.text ?? "Figure", text: value.text, color },
    ...(interval
      ? [
          {
            key: "interval",
            name: "90% interval",
            text: interval.text.replace(/^90% interval: /, ""),
            color: CHART_COLOURS.reference,
          },
        ]
      : []),
  ];
}

const CHART_TITLE = "Constituency-level impacts";

// The card's two views, and the URL parameter that opens the second.
const PANELS = ["map", "rankings"];
const PANEL_PARAM = "map";
const PANEL_OPTIONS = [
  { value: "map", label: "Map", icon: <MapIcon /> },
  { value: "rankings", label: "Rankings", icon: <ListIcon /> },
];

// Excel reads a CSV as UTF-8 only with a byte-order mark ("Ynys Môn").
const UTF8_BOM = "\uFEFF";

// Drill builds set NEXT_PUBLIC_MOCK=1; their numbers must never read as real.
const isMockBuild = () => process.env.NEXT_PUBLIC_MOCK === "1";

/**
 * The card's view, kept in the URL as ?map=rankings (the map, the default,
 * leaves the URL alone), as the sub-tabs keep theirs.
 */
function usePanelParam() {
  const [panel, setPanel] = useState(() => {
    if (typeof window === "undefined") return PANELS[0];
    const value = new URLSearchParams(window.location.search).get(PANEL_PARAM);
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
    [packageChoice ? "Measures" : "Measure", measures],
    ["Reform", reform],
    ["Year", yearLabel],
    ["Units", EXPORT_UNITS],
    ["Source", "PolicyEngine UK Autumn Budget 2026 dashboard"],
  ]);
}

/** The exported map's description: what it shows, and how to read it. */
const exportDescription = (label, outcome) =>
  `${label}. Each constituency is coloured by the size of its average ` +
  `change in household net income, in ${OUTCOME_LABELS[outcome]}, when its ` +
  "90% interval is narrow enough to tell. Dotted constituencies rest on " +
  "few survey households; hatched ones are not published, to protect " +
  "survey respondents' confidentiality.";

// The map's drawing area, in SVG units.
const WIDTH = 800;
const HEIGHT = 600;
const MAP_LOGO_CLASS = "map-logo";

/**
 * The part of the SVG on screen, in its units. The SVG fills the width of
 * the page, so on a wide screen it shows more than the drawing area, on
 * either side of the map.
 */
const DRAWING_AREA = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };

function shownArea(width, height) {
  if (!(width > 0 && height > 0)) return DRAWING_AREA;
  const scale = Math.min(width / WIDTH, height / HEIGHT);
  const left = (WIDTH - width / scale) / 2;
  const top = (HEIGHT - height / scale) / 2;
  return { left, top, right: WIDTH - left, bottom: HEIGHT - top };
}

/** Put the legend in the top-left corner of what is shown, the logo in the
 * bottom-right one. */
function placeInCorners(svg, area) {
  placeMapLegend(svg.select(`g.${MAP_LEGEND_CLASS}`), {
    x: area.left + LEGEND_INSET,
    y: area.top + LEGEND_INSET,
  });
  svg
    .select(`image.${MAP_LOGO_CLASS}`)
    .attr("x", area.right - CHART_LOGO.width - CHART_LOGO.padding)
    .attr("y", area.bottom - CHART_LOGO.height - CHART_LOGO.padding);
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
    (WIDTH - 2 * padding) / dataWidth,
    (HEIGHT - 2 * padding) / dataHeight,
  );
  const offsetX = (WIDTH - dataWidth * scale) / 2;
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

function strokeFor(code, states, selectedCode) {
  if (code === selectedCode) return SELECTED_STROKE;
  return seatStyle(states?.get(code));
}

function TooltipLines({ lines }) {
  return lines.map((line, index) => {
    if (line.kind === "value") {
      return (
        <p
          key={index}
          className="tooltip-value"
          style={{ color: DIRECTION_TEXT_COLOURS[line.direction] }}
        >
          {line.text}
        </p>
      );
    }
    const className = {
      label: "tooltip-label",
      interval: line.emphasis
        ? "tooltip-interval tooltip-interval-emphasis"
        : "tooltip-interval",
      region: "tooltip-region",
      note: "tooltip-note",
    }[line.kind] ?? "tooltip-detail";
    return (
      <p key={index} className={className}>
        {line.text}
      </p>
    );
  });
}

/**
 * Constituency results as the disclosure layer published them, for one
 * measure or the whole package, one outcome and one year. Seats are
 * coloured by category, dotted when approximate, hatched when withheld,
 * light grey when too uncertain to classify, and drawn as no data when
 * there is no row. Nothing is summed across measures. It draws only on a
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
function MapTemplate({ features, children }) {
  const paths = useMemo(() => {
    if (!features?.length) return null;
    const path = d3.geoPath().projection(gridProjection(features));
    return features.map((feature) => ({ code: seatCode(feature), d: path(feature) }));
  }, [features]);
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
  const scale = [
    ["large_loss", "Loss"],
    ["small_loss", null],
    ["little_change", null],
    ["small_gain", null],
    ["large_gain", "Gain"],
  ];
  return (
    <div className="map-scale-placeholder" aria-hidden="true">
      <span className="map-scale-end">Loss</span>
      {scale.map(([category]) => (
        <span
          key={category}
          className="map-scale-swatch"
          style={{ background: CATEGORY_COLOURS[category] }}
        />
      ))}
      <span className="map-scale-end">Gain</span>
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
  const [panel, setPanel] = usePanelParam();
  const [selectedCode, setSelectedCode] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [svgNode, setSvgNode] = useState(null);
  const [area, setArea] = useState(DRAWING_AREA);
  const areaRef = useRef(DRAWING_AREA);
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
  // On a release that routes no results by area, the card describes the
  // measure only, not how to read a map it does not draw.
  const notRouted = areaViewsNotAvailable(routing);
  const reform = view.kind === "rows" ? view.reform : null;
  const label = choiceLabel(choice, policies);
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

  // The Rankings view: every seat's figures for the reform and year, ranked
  // by the outcome the map shows.
  const metric = outcome === "average_change" ? "gbp" : "pct";
  const rankingEntriesForView = useMemo(
    () => rankingEntries(features, constituencyTable, { reform, year: selectedYear }),
    [features, constituencyTable, reform, selectedYear],
  );
  const rankingShown = useMemo(() => {
    const ranked = rankConstituencies(rankingEntriesForView, metric);
    const { top, bottom } = selectTopAndBottom(ranked, TABLE_SIZE);
    return [...top, ...bottom];
  }, [rankingEntriesForView, metric]);
  const rankingsReady = Boolean(reform) && rankingShown.length > 0;

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
      const feature = featuresByCode.get(code);
      if (!map || !feature) return;
      const [[x0, y0], [x1, y1]] = map.path.bounds(feature);
      const scale = Math.max(
        1,
        Math.min(4, 0.9 / Math.max((x1 - x0) / WIDTH, (y1 - y0) / HEIGHT)),
      );
      const x = (x0 + x1) / 2;
      const y = (y0 + y1) / 2;
      map.svg
        .transition()
        .duration(750)
        .call(
          map.zoom.transform,
          d3.zoomIdentity
            .translate(WIDTH / 2 - scale * x, HEIGHT / 2 - scale * y)
            .scale(scale),
        );
    },
    [featuresByCode],
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
    if (!svgNode || !features) return undefined;
    const svg = d3.select(svgNode);
    svg.selectAll("*").remove();
    appendStatusPatterns(svg.append("defs"));
    const layer = svg.append("g").attr("class", MAP_ZOOM_LAYER_CLASS);
    const path = d3.geoPath().projection(gridProjection(features));
    layer
      .selectAll("path")
      .data(features, seatCode)
      .join("path")
      .attr("class", "constituency-path")
      .attr("data-code", seatCode)
      .attr("d", path)
      .style("cursor", "pointer");
    svg.append("g").attr("class", MAP_LEGEND_CLASS);
    svg
      .append("image")
      .attr("class", MAP_LOGO_CLASS)
      .attr("href", CHART_LOGO.href)
      .attr("width", CHART_LOGO.width)
      .attr("height", CHART_LOGO.height);
    placeInCorners(svg, areaRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([1, 8])
      .extent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on("zoom", (event) => layer.attr("transform", event.transform));
    svg.call(zoom);
    mapRef.current = { svg, layer, path, zoom };
    // A seat still selected from before the map was redrawn is centred
    // again, where its tooltip sits.
    if (selectedRef.current) zoomToSeat(selectedRef.current);
    return () => {
      svg.interrupt();
      layer.selectAll("path").interrupt();
      svg.on(".zoom", null);
      mapRef.current = null;
    };
  }, [svgNode, features, zoomToSeat]);

  // Follow the SVG's size, so the legend and logo stay in the corners.
  useEffect(() => {
    if (!svgNode || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = shownArea(entry.contentRect.width, entry.contentRect.height);
      setArea((previous) =>
        Math.abs(previous.left - next.left) < 0.5 &&
        Math.abs(previous.top - next.top) < 0.5
          ? previous
          : next,
      );
    });
    observer.observe(svgNode);
    return () => observer.disconnect();
  }, [svgNode]);

  useEffect(() => {
    areaRef.current = area;
    if (mapRef.current) placeInCorners(mapRef.current.svg, area);
  }, [area]);

  // Colour the seats, draw the legend and attach the handlers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !states) return;
    const seats = map.layer.selectAll("path.constituency-path");
    seats.each(function (feature) {
      const node = d3.select(this);
      const style = seatStyle(states.get(seatCode(feature)));
      const previous = node.attr("fill");
      node.interrupt();
      node.attr("fill-opacity", style.fillOpacity);
      node.attr("data-state", states.get(seatCode(feature))?.kind ?? "no-data");
      // A pattern's url() cannot be blended with a colour, so only a
      // change from one colour to another is animated.
      if (isColour(previous) && isColour(style.fill) && previous !== style.fill) {
        const blend = d3.interpolateRgb(previous, style.fill);
        // Ends on the colour exactly as written, not as rgb().
        node
          .transition()
          .duration(500)
          .attrTween("fill", () => (t) => (t < 1 ? blend(t) : style.fill));
      } else {
        node.attr("fill", style.fill);
      }
    });
    applyStrokes();
    drawMapLegend(map.svg.select(`g.${MAP_LEGEND_CLASS}`), { outcome });
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
  }, [svgNode, features, states, outcome, applyStrokes, selectSeat]);

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

  const selectedFeature = selectedCode ? featuresByCode.get(selectedCode) : null;
  const tooltip =
    states && selectedFeature
      ? describeSeat({
          feature: selectedFeature,
          state: states.get(selectedCode),
          regional: regionalTable,
          reform,
          year: selectedYear,
          outcome,
        })
      : null;

  // The hovered seat's tooltip, from the current rows (never another
  // year's), unless it is the selected seat, whose card is open
  const hoverFeature =
    hoverSeat && hoverSeat.stamp === hoverStamp && hoverSeat.code !== selectedCode
      ? featuresByCode.get(hoverSeat.code)
      : null;
  const hoverDescribed =
    states && hoverFeature
      ? describeSeat({
          feature: hoverFeature,
          state: states.get(hoverSeat.code),
          regional: regionalTable,
          reform,
          year: selectedYear,
          outcome,
        })
      : null;
  const hoverTip = hoverDescribed
    ? {
        key: hoverSeat.code,
        x: hoverSeat.x,
        y: hoverSeat.y,
        content: (
          <TooltipRows
            label={`${hoverDescribed.title}, ${yearLabel}`}
            rows={seatTooltipRows(hoverDescribed)}
          />
        ),
      }
    : null;

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
    description: exportDescription(label, outcome),
    logo: CHART_LOGO,
    tooltip,
  });
  const handleExportSvg = async () => {
    if (!svgNode) return;
    await exportMapAsSvg(svgNode, exportName, exportOptions());
  };
  // The CSV holds the published strings for every constituency, as the
  // region export does: withheld figures stay blank.
  const handleExportCsv = () => {
    const text = constituencyCsvText(constituencyTable, {
      reform,
      year: selectedYear,
      yearLabel,
      packageChoice: choice.kind === "package",
      label,
      names: choiceMeasureNames(choice, policies),
    });
    if (text) {
      downloadFile(
        text,
        `constituency-results-${reform}-${selectedYear}.csv`,
        "text/csv;charset=utf-8",
      );
    }
  };
  const mapDownloads = {
    csv: handleExportCsv,
    png: async () => {
      if (!svgNode) return;
      await downloadSvgAsPng(await buildMapSvg(svgNode, exportOptions()), exportName);
    },
    svg: handleExportSvg,
  };
  // The Rankings view's CSV: every constituency on the map, ranked.
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
  const onMap = panel === "map";
  const downloadsReady = onMap ? view.kind === "rows" : rankingsReady;
  const downloads = onMap ? mapDownloads : { csv: handleExportRankings };
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

  return (
    <div className="constituency-map-wrapper">
      <div className="map-header">
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="map" />
              <span className="title-text">
                {CHART_TITLE}, <span className="nowrap">{yearLabel}</span>
              </span>
            </h3>
            <p className="chart-description">
              {notRouted ? (
                "Average change in household net income by constituency."
              ) : onMap ? (
                <>
                  Average change in household net income by constituency.
                  Uncoloured where the estimate is too uncertain.
                </>
              ) : (
                <>
                  The {TABLE_SIZE} constituencies with the largest gains and
                  the {TABLE_SIZE} with the largest losses, ranked by{" "}
                  {OUTCOME_LABELS[outcome]}.
                </>
              )}
            </p>
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
        <div className="map-top-bar">
          <ViewSwitch
            label="Show constituencies as"
            options={PANEL_OPTIONS}
            value={panel}
            onChange={setPanel}
          />
          {view.kind === "rows" &&
            (onMap ? (
              <OutcomeToggle value={outcome} onChange={setOutcome} />
            ) : (
              <OutcomeToggle
                value={outcome}
                onChange={setOutcome}
                label="Rank by"
                prefix="Rank by"
              />
            ))}
          {/* The map view's search, on the same line as the view switch */}
          {onMap && view.kind !== "loading" && (
            <div className="map-search-section">
              <div className="search-container">
                {view.kind === "rows" ? (
                  <input
                    key="search"
                    id="constituency-search"
                    type="search"
                    aria-label="Search constituency"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search or select a constituency"
                    className="constituency-search"
                    autoComplete="off"
                  />
                ) : (
                  <input
                    key="search-disabled"
                    id="constituency-search"
                    type="search"
                    aria-label="Search constituency"
                    placeholder="Search or select a constituency"
                    className="constituency-search"
                    disabled
                  />
                )}
                {view.kind === "rows" && searchResults.length > 0 && (
                  <div className="search-results">
                    {searchResults.map((result) => (
                      <button
                        key={result.code}
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          selectSeat(result.code);
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
          )}
        </div>
      </div>

      <div className="chart-plot constituency-body">
        {view.kind === "loading" && (
          <p className="constituency-loading">Loading map…</p>
        )}

        {/* The one notice, over whichever view is shown */}
        {view.kind === "notice" && onMap && (
          <MapTemplate features={boundariesReady ? features : null}>{notice}</MapTemplate>
        )}

        {!onMap && view.kind !== "loading" && (
          <div className="rankings-panel">
            <ConstituencyRankings
              entries={view.kind === "rows" ? rankingEntriesForView : []}
              metric={metric}
              outcome={outcome}
              yearLabel={yearLabel}
            />
            {notice && <div className="map-template-overlay">{notice}</div>}
            {rankingsReady && rankingShown.some(isApproximate) && (
              <p className="rankings-note">
                {APPROXIMATE_MARK} {APPROXIMATE_NOTE}
              </p>
            )}
          </div>
        )}

        {/* Kept mounted in the Rankings view, so the map keeps its zoom */}
        {view.kind === "rows" && (
          <div className="map-content" hidden={!onMap}>
            <div className="map-canvas" ref={canvasRef}>
              <svg
                ref={setSvgNode}
                width={WIDTH}
                height={HEIGHT}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`Map of ${CHART_TITLE.toLowerCase()}, ${label}, ${yearLabel}`}
                onClick={clearSelection}
              />

              <div
                className="map-controls-container"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="zoom-controls">
                  <button
                    className="zoom-control-btn"
                    onClick={() => handleZoom(1.5)}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M10 7V13M7 10H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M15 15L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className="zoom-control-btn"
                    onClick={() => handleZoom(0.67)}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M7 10H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M15 15L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className="zoom-control-btn"
                    onClick={handleResetZoom}
                    title="Reset zoom"
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
                </div>
              </div>

              {tooltip && (
                <div
                  className="constituency-tooltip"
                  aria-live="polite"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="tooltip-close"
                    aria-label="Close"
                    onClick={clearSelection}
                  >
                    ×
                  </button>
                  <h4>{tooltip.title}</h4>
                  <TooltipLines lines={tooltip.lines} />
                </div>
              )}
              <FloatingTooltip tip={hoverTip} />
            </div>
          </div>
        )}
      </div>

      <div className="chart-legend">
        {/* Kept, unseen, in the Rankings view, so the card keeps its height */}
        {view.kind !== "rows" && (
          <div style={{ visibility: onMap ? "visible" : "hidden" }}>
            <MapScalePlaceholder />
          </div>
        )}
      </div>

      <div className="chart-logo">
        {/* The drawn map carries its own logo */}
        {!(onMap && view.kind === "rows") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={CHART_LOGO.href} alt="PolicyEngine" />
        )}
      </div>

    </div>
  );
}
