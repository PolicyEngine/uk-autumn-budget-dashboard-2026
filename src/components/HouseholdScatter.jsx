import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_LOGO, PolicyEngineLogo } from "../utils/chartLogo";
import { SCATTER_BINS, changeKind } from "../utils/publication/scatter";
import { fiscalYearLabel } from "../utils/publication/format";
import {
  clampToAxis,
  fitChangeAxisAcrossYears,
  householdsPerDot,
  INCOME_AXIS_DOMAIN,
  incomeLikeYours,
  panelDots,
  scatterCsv,
  decilesShowChange,
  scatterView,
} from "../utils/householdScatter";
import { useNarrowViewport, Y_TITLE_GUTTER, CHART_COLOURS, noHouseholdChange, chartMargin } from "../utils/chartTheme";
import { useHouseholdScatterData } from "../hooks/useHouseholdScatterData";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { selectionPackageKey, showAllLabel, showAloneLabel } from "../utils/geography/selection";
import { colourFor } from "./publication/BinnedHouseholdScatter";
import ChartDownloadMenu from "./ChartDownloadMenu";
import ChartMoreInfo from "./ChartMoreInfo";
import { ViewportBox, pointIn } from "./ViewportTooltip";
import { METHOD_ANCHORS } from "./methodology/anchors";
import ChartUnitLabel from "../utils/ChartUnitLabel";
import NoBreakYear from "./NoBreakYear";
import "./PillSelect.css";
import "./HouseholdScatterTemplate.css";
import { DEFAULT_DISPLAY_YEAR } from "../utils/displayYears";
import TitleIcon from "./TitleIcon";

// The 2025 dashboard's household scatter (HouseholdChart, Autumn Budget
// 2025), drawn from the binned cells: same axes, ticks, grid, zero line,
// dot size and colours. Its dots were sampled households; these are fixed
// shares of groups of households, which keep their rows across years.
const CHART_TITLE = "Household income impacts";
const INCOME_TICKS = [0, 20000, 40000, 60000, 80000, 100000, 120000, 140000];
const thousands = (value) => `${value / 1000}`;
// Change ticks in pounds: "−£500", "£0", "£2.5k"
const changeTick = (value) => {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `£${abs / 1000}k` : `£${abs}`;
  return value < 0 ? `\u2212${text}` : text;
};
// 2025: Recharts' default scatter symbol (area 64, so r ≈ 4.5) at an
// opacity of 0.5 to 0.95 by household weight, which its Cell set as both
// `opacity` and `fill-opacity` (so a dot showed at about its square).
// Every dot here stands for the same number of households, so all take
// the 2025 sample's typical value (its median, 0.51), set both ways.
const DOT_RADIUS = Math.sqrt(64 / Math.PI);
const DOT_OPACITY = 0.51;
const GRID = { strokeDasharray: "3 3", stroke: CHART_COLOURS.grid };
const TICK = { fontSize: 11, fill: CHART_COLOURS.tick };
const AXIS_TITLE = { fontSize: 12, fill: CHART_COLOURS.text };
// Below the side-by-side layout the plot keeps the 2025 chart's height;
// beside the income decile card it takes that card's plot height (see
// HouseholdScatterTemplate.css).
const STACKED_HEIGHT = 400;
// Room under the axis for the logo, drawn in the SVG as the decile card
// beside it draws its own (WaterfallChart's LOGO_ROOM), so the two plots,
// axis titles and logos sit level
export const LOGO_ROOM = CHART_LOGO.height + CHART_LOGO.padding + 6;

// The dots' colours, as colourFor draws them; the key under the plot
// carries them. Groups beyond the axis sit at its edge, coloured alike.
// Only gain and loss are keyed (Vahid, 26 October): a group with no
// change, (−£1, £1), is drawn as an unfilled ring on £0 and its tooltip
// says "No change".
const KEY = [
  { label: "Gain", color: CHART_COLOURS.gain },
  { label: "Loss", color: CHART_COLOURS.loss },
];
const isNoChange = (dot) => colourFor(dot) === CHART_COLOURS.noChange;
// The reader's household, when the chart is shown with one (`you`): a
// dark ring with a solid centre, drawn over the dots
const YOU_COLOUR = CHART_COLOURS.net;
const YOU_RING = 8;
const YOU_KEY = { label: "You", color: YOU_COLOUR };

const number = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
const pounds = (value) => `${value < 0 ? "-" : ""}£${number(Math.abs(value))}`;
const roundedThousands = (value) => number(Math.max(1000, Math.round(value / 1000) * 1000));

// One short line; the income basis and how dots follow across years are in About this chart
const describe = (perDot) =>
  `Each dot is about ${roundedThousands(perDot)} households: right of the line they gain, left they lose.`;

// The same line on the card, with the gain and loss colours as dots
// beside their words: the chart's key, so no key row under the plot
const KeyWord = ({ color, children }) => (
  <span className="scatter-key-word">
    <span className="scatter-legend-dot" style={{ background: color }} aria-hidden="true" />
    {children}
  </span>
);
const describeWithKey = (perDot) => (
  <>
    Each dot is about {roundedThousands(perDot)} households: right of the line they{" "}
    <KeyWord color={CHART_COLOURS.gain}>gain</KeyWord>, left they{" "}
    <KeyWord color={CHART_COLOURS.loss}>lose</KeyWord>.
  </>
);

/**
 * The card's "About this chart": how to read a dot and the axes. The
 * subtitle already gives the households per dot and the side of the line
 * that gains; how the groups and bands are set is in Methodology.
 */
function ScatterMoreInfo({ basisLabel }) {
  return (
    <ChartMoreInfo
      info={{
        how: [
          `Each dot is a group of households with similar ${basisLabel} incomes under current law (${pounds(SCATTER_BINS.income_band_width)} bands).`,
          "The groups and the change axis are the same in every year. Changes beyond the axis show as arrows at its edge.",
          "No change (under £1 either way) is an unfilled ring on £0.",
        ],
        caveats: ["Groups with too few survey households are left out."],
        method: { anchor: METHOD_ANCHORS.scatter, label: "How the household groups are built" },
      }}
    />
  );
}
const DESCRIPTION_LOADING = "Change in net income by baseline income.";
// In place of the dots when the groups that gain or lose are left out
export const HOUSEHOLDS_WITHHELD_NOTE = "Not published, too few survey households.";

// Dots move between years and selections as the other charts' bars do:
// about 850ms, easing in and out, and not at all under reduced motion.
const TWEEN_MS = 850;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const withOpacity = (dots) => dots.map((dot) => ({ ...dot, opacity: dot.hidden ? 0 : 1 }));

/**
 * The dots as drawn. Each moves from where it was to where it now belongs,
 * found by its key (its income band and rank), so a dot that keeps its
 * group slides sideways. New dots fade in where they belong; a dot whose
 * place is off the plot fades out.
 */
function useTweenedDots(dots) {
  const [shown, setShown] = useState(() => withOpacity(dots));
  const shownRef = useRef(shown);
  useEffect(() => {
    const target = withOpacity(dots);
    const from = new Map(shownRef.current.map((dot) => [dot.key, dot]));
    const settle = (next) => {
      shownRef.current = next;
      setShown(next);
    };
    if (reducedMotion() || from.size === 0) {
      settle(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = easeInOut(t);
      settle(
        target.map((dot) => {
          const was = from.get(dot.key);
          if (!was) return { ...dot, opacity: dot.opacity * e };
          return {
            ...dot,
            change: was.change + (dot.change - was.change) * e,
            income: was.income + (dot.income - was.income) * e,
            opacity: was.opacity + (dot.opacity - was.opacity) * e,
          };
        }),
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dots]);
  return shown;
}

/**
 * The dots, drawn in the chart's SVG (so downloads carry them) on its own
 * axes. Recharts passes the axis maps; hovering a dot reports its group.
 */
function DotLayer({ xAxisMap, yAxisMap, width, dots, onHover }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  const left = xAxis.x - DOT_RADIUS;
  const right = xAxis.x + xAxis.width + DOT_RADIUS;
  return (
    <g className="household-scatter-dots" onMouseLeave={() => onHover(null)}>
      {dots.map((dot) => {
        const cx = xAxis.scale(dot.change);
        const cy = yAxis.scale(dot.income);
        // Fading out, or (mid-tween) beyond the axis: not drawn
        if (dot.opacity <= 0.01 || cx < left || cx > right) return null;
        const hover = () => onHover(dot.hidden ? null : { dot, x: cx, y: cy, width });
        if (dot.clamped) {
          // Beyond the axis: an arrow on the edge, pointing the way it lies
          const out = dot.change < 0 ? -1 : 1;
          const r = DOT_RADIUS * 1.2;
          return (
            <path
              key={dot.key}
              data-dot={dot.key}
              data-capped={out < 0 ? "low" : "high"}
              d={`M${cx + out * r},${cy} L${cx - out * r * 0.6},${cy - r} L${cx - out * r * 0.6},${cy + r} Z`}
              fill={colourFor(dot)}
              fillOpacity={DOT_OPACITY}
              opacity={DOT_OPACITY * Math.min(1, dot.opacity)}
              onMouseEnter={hover}
            />
          );
        }
        return (
          <circle
            key={dot.key}
            data-dot={dot.key}
            cx={cx}
            cy={cy}
            r={DOT_RADIUS}
            fill={isNoChange(dot) ? "none" : colourFor(dot)}
            fillOpacity={DOT_OPACITY}
            opacity={DOT_OPACITY * Math.min(1, dot.opacity)}
            stroke={isNoChange(dot) ? CHART_COLOURS.noChange : undefined}
            strokeWidth={isNoChange(dot) ? 1 : 0}
            onMouseEnter={hover}
          />
        );
      })}
    </g>
  );
}

// "£1,240" / "−£1,240" for the You label, "£182k" for an income
const signed = (value) => `${value < 0 ? "\u2212" : ""}£${number(Math.abs(value))}`;
const incomeK = (value) => `£${number(Math.round(value / 1000))}k`;

/**
 * The reader's household on the plot: a dark ring with a solid centre at
 * (their change, their income), and "You" on a short leader line. Off the
 * axes, it sits at the edge with an arrow pointing out and its true value
 * in the label. Drawn in the chart's SVG, so downloads carry it; it takes
 * no pointer events, so the dots under it keep their tooltips.
 */
function YouLayer({ xAxisMap, yAxisMap, you, changeDomain }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale || !you) return null;
  const [low, high] = changeDomain;
  const [incomeLow, incomeHigh] = INCOME_AXIS_DOMAIN;
  const xOff = you.change < low ? "left" : you.change > high ? "right" : null;
  const yOff = you.income < incomeLow ? "down" : you.income > incomeHigh ? "up" : null;
  // Pinned at an edge, the ring sits just inside it, leaving room for
  // its arrow within the plot
  const inset = YOU_RING + 12;
  let cx = xAxis.scale(Math.min(high, Math.max(low, you.change)));
  let cy = yAxis.scale(Math.min(incomeHigh, Math.max(incomeLow, you.income)));
  if (xOff === "left") cx = Math.max(cx, xAxis.x + inset);
  if (xOff === "right") cx = Math.min(cx, xAxis.x + xAxis.width - inset);
  if (yOff === "up") cy = Math.max(cy, yAxis.y + inset);
  if (yOff === "down") cy = Math.min(cy, yAxis.y + yAxis.height - inset);
  const plotLeft = xAxis.x;
  const plotRight = xAxis.x + xAxis.width;
  // The label goes to the side with more room, and below the ring near
  // the top of the plot
  const toLeft = cx > (plotLeft + plotRight) / 2;
  const below = cy - yAxis.y < 34;
  const dx = toLeft ? -1 : 1;
  const dy = below ? 1 : -1;
  const lx = cx + dx * 22;
  const ly = cy + dy * 22;
  const parts = [you.label ?? "You"];
  if (xOff) parts.push(signed(you.change));
  if (yOff) parts.push(`income ${incomeK(you.income)}`);
  const text = parts.join(": ").replace(/: (income)/, ", $1");
  // An arrow just outside the ring, pointing off the axis
  const arrows = [];
  if (xOff) arrows.push(xOff === "left" ? [-1, 0] : [1, 0]);
  if (yOff) arrows.push(yOff === "up" ? [0, -1] : [0, 1]);
  return (
    <g className="household-scatter-you" pointerEvents="none" data-you="true">
      <line
        x1={cx + dx * (YOU_RING + 1)}
        y1={cy + dy * (YOU_RING + 1)}
        x2={lx - dx * 2}
        y2={ly - dy * 2}
        stroke={YOU_COLOUR}
        strokeWidth={1.25}
      />
      {arrows.map(([ax, ay]) => {
        const tipX = cx + ax * (YOU_RING + 9);
        const tipY = cy + ay * (YOU_RING + 9);
        const baseX = cx + ax * (YOU_RING + 3);
        const baseY = cy + ay * (YOU_RING + 3);
        const px = -ay * 4;
        const py = ax * 4;
        return (
          <polygon
            key={`${ax}:${ay}`}
            points={`${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`}
            fill={YOU_COLOUR}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={YOU_RING + 2} fill="none" stroke={CHART_COLOURS.surface} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={YOU_RING} fill={CHART_COLOURS.surface} fillOpacity={0.85} stroke={YOU_COLOUR} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={3.5} fill={YOU_COLOUR} />
      <text
        x={lx}
        y={ly}
        dy={below ? "0.8em" : "0"}
        textAnchor={toLeft ? "end" : "start"}
        fontSize={12}
        fontWeight={700}
        fill={YOU_COLOUR}
        stroke={CHART_COLOURS.surface}
        strokeWidth={3}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * The line above the plot when the chart shows the reader's household:
 * what a dot is, which marker is theirs, and how households with incomes
 * like theirs changed (from the year's published cells; left out when
 * they say nothing honest: incomeLikeYours).
 */
function youSentence({ perDot, you, points, basisLabel, incomeMatches }) {
  const parts = [
    `Each dot is about ${roundedThousands(perDot)} UK households; you are the dark ring.`,
  ];
  const like = incomeMatches ? incomeLikeYours(points, you.income) : null;
  if (like) {
    const span = `${basisLabel} net income of ${pounds(like.incomeLow)} to ${pounds(like.incomeHigh)}`;
    const share = `${Math.round(like.share * 10)} in 10 households with ${span}, like yours,`;
    let change;
    if (like.low === 0 && like.high === 0) change = "see no change";
    else if (like.low >= 0) change = `gain between ${pounds(like.low)} and ${pounds(like.high)}`;
    else if (like.high <= 0) change = `lose between ${pounds(-like.high)} and ${pounds(-like.low)}`;
    else change = `see a change between ${signed(like.low)} and ${signed(like.high)}`;
    parts.push(`${share} ${change} a year.`);
  }
  if (incomeMatches && you.income >= INCOME_AXIS_DOMAIN[1]) {
    parts.push(
      `The chart stops at ${pounds(INCOME_AXIS_DOMAIN[1])} of ${basisLabel} net income, so households like yours are not shown; your ring sits at its top.`,
    );
  }
  if (you.note) parts.push(you.note);
  return parts.join(" ");
}

/** The tooltip, in the 2025 chart's style, describing the dot's group. */
function GroupTooltip({ hover, basisLabel, yearLabel }) {
  if (!hover) return null;
  const point = hover.dot;
  const incomeTop = Math.min(
    point.incomeBand + SCATTER_BINS.income_band_width,
    SCATTER_BINS.income_max,
  );
  const kind = changeKind(point.changeBand, point.changeBandUpper);
  const change =
    kind === "zero"
      ? "no change"
      : `a change of ${pounds(point.changeBand)} to ${pounds(point.changeBandUpper)}`;
  return (
    <ViewportBox locate={(probe) => pointIn(probe, hover.x, hover.y)} offset={12}>
    <div className="household-scatter-tooltip">
      <p>
        In {yearLabel}, about <strong>{number(point.households)} households</strong> with{" "}
        {basisLabel} income{" "}
        <strong>
          {pounds(point.incomeBand)}–{pounds(incomeTop)}
        </strong>{" "}
        had <strong style={{ color: colourFor(point) }}>{change}</strong>.
        {point.clamped
          ? " This is beyond the axis, so it is drawn as an arrow at its edge, pointing the way it lies."
          : ""}
      </p>
    </div>
    </ViewportBox>
  );
}

/**
 * Households by baseline net income and the change in it, drawn as the
 * 2025 dashboard drew its 500 sampled households: change on the x axis
 * (fitted to the dots shown: fitChangeAxis), baseline household net income
 * on the y axis (£0 to £150,000), uniform dots coloured by gain, loss or no
 * change, and changes beyond the axis drawn at its edge.
 *
 * The dots come from the binned cells in household_scatter_binned.csv
 * (£5,000 income bands by change bands). Every year's households are
 * banded by their baseline income in the basis year (2027-28), so a band
 * is the same households in every year. Each band gets its dots once, by
 * its households in the basis year, and its k-th dot stands at the band's
 * k-th weighted quantile of change in the year shown (panelDots): when the
 * year changes, a dot keeps its row and its rank, and slides sideways. No
 * survey household is shown on its own (#30): a dot's tooltip gives its
 * group.
 *
 * Cells are published per reform: one policy shows its own, several the
 * published combined run of exactly those policies, and with no such run
 * a notice. The policies are the header's selection; the card has no
 * policy choice of its own.
 *
 * With `you` ({change, income, label?, incomeYear?, note?}), the chart
 * places the reader's household on it (Household calculator): `change` is its
 * change in net income in `selectedYear`, `income` its baseline household
 * net income, the y axis's concept, in `incomeYear` (the basis year when
 * not given). The title is then `title`, and the line under it says what a
 * dot is and how households with incomes like the reader's changed.
 *
 * `embedded` draws it as one view of another card (the Household calculator
 * position card): no title, download menu or logo of its own; the card's
 * menu takes this chart's download, handed up through `onDownload`.
 *
 * `onPoliciesSet` is the header picker's setter (Select all): given it, a
 * selection of some policies gets buttons to show all of them or the first
 * alone, the two runs the chart can draw.
 */
function HouseholdScatter({
  selectedPolicies,
  policies,
  selectedYear = DEFAULT_DISPLAY_YEAR,
  you = null,
  title = CHART_TITLE,
  embedded = false,
  onDownload = null,
  // A link on the subtitle line, after the sentence
  descriptionLink = null,
  onPoliciesSet = null,
}) {
  const narrow = useNarrowViewport();
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const data = useHouseholdScatterData();
  // Several policies: the published combined run of exactly them, if any
  const catalogue = useMeasureCatalogue();
  const { manifest } = catalogue;
  const packageKey = selectionPackageKey(manifest, selectedPolicies);
  const view = useMemo(
    () => scatterView({
      data,
      selectedIds: selectedPolicies,
      policyIds: (policies ?? []).filter((policy) => policy.displayable !== false).map((policy) => policy.id),
      year: selectedYear,
      packageKey,
      fullPackageKey: catalogue.combinedId ?? null,
    }),
    [data, selectedPolicies, policies, selectedYear, packageKey, catalogue.combinedId],
  );
  const yearLabel = fiscalYearLabel(selectedYear);
  const chartTitle = `${title}, ${yearLabel}`;
  const ready = view.kind === "points";
  const basisLabel = ready ? fiscalYearLabel(view.basisYear) : null;
  // The change axis is fitted once per selection, across every year, so
  // it stays put while the year changes; dots beyond it sit at its edge
  const reform = ready ? view.reform : null;
  const yearPoints = ready ? view.yearPoints : null;
  const basisPoints = ready ? view.basisPoints : null;
  const changeAxis = useMemo(
    () => fitChangeAxisAcrossYears(basisPoints ?? [], yearPoints ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reform, data],
  );
  const dots = useMemo(() => {
    const placed = ready ? panelDots(view.basisPoints, view.points) : [];
    return clampToAxis(placed, changeAxis.domain);
  }, [ready, view, changeAxis]);
  const shown = useTweenedDots(dots);
  // The reader's income is on the y axis's basis only if it is for the
  // basis year; otherwise the ring is placed by it, and the line says so
  const incomeMatches = ready && you && (you.incomeYear ?? view.basisYear) === view.basisYear;
  const youShown =
    ready && you && Number.isFinite(you.change) && Number.isFinite(you.income) ? you : null;
  // Every published cell this year in the zero band (under £1), and the
  // reader's household unchanged too: a note, not a column of dots at £0.
  // Only for a published result (ready); a notice says why not
  const zeroCells =
    ready &&
    view.points.every((point) => changeKind(point.changeBand, point.changeBandUpper) === "zero") &&
    (!youShown || Math.round(youShown.change) === 0);
  // Cells with too few survey households are left out, so zero cells alone
  // do not mean no household's income changes: when the reform's income
  // decile results show a change, or withhold one, the groups that change
  // were withheld, and the plot says so in place of dots. Only a selection
  // whose deciles are all zero (an employer cost alone) gets "None of the
  // selected policies changes…"
  const changesWithheld =
    zeroCells &&
    decilesShowChange(catalogue.tablesByKey?.[view.reform]?.distributional_impact, view.reform, selectedYear);
  const nothingChanges = zeroCells && !changesWithheld;
  // Either way no dots are drawn
  const noDots = nothingChanges || changesWithheld;
  // No dots drawn (a note in their place): the plain subtitle, not "Each
  // dot is about …"
  const description = !ready || noDots
    ? DESCRIPTION_LOADING
    : youShown
      ? youSentence({
          perDot: householdsPerDot(view.basisPoints),
          you: incomeMatches
            ? youShown
            : {
                ...youShown,
                note: [
                  `Your ring is placed by your ${fiscalYearLabel(youShown.incomeYear)} net income; the dots by ${basisLabel}'s.`,
                  youShown.note,
                ]
                  .filter(Boolean)
                  .join(" "),
              },
          points: view.points,
          basisLabel,
          incomeMatches,
        })
      : describe(householdsPerDot(view.basisPoints));
  const key = youShown ? [...KEY, YOU_KEY] : KEY;

  // A hovered dot's group belongs to the year and selection it was
  // hovered in
  const hover = hovered && hovered.dots === dots ? hovered : null;
  const onHover = (next) => setHovered(next && { ...next, dots });

  const exportName = you
    ? `your-household-among-uk-households-${selectedYear}`
    : `household-income-impacts-${selectedYear}`;
  const exportOptions = {
    title: chartTitle,
    description,
    legendItems: key.map((item) => ({ ...item, type: "circle" })),
    logo: CHART_LOGO,
    // No Recharts legend: the whole SVG is the plot, so crop nothing
    reservedLegendHeight: 0,
  };
  const download = ready
    ? {
        chartRef,
        name: exportName,
        exportOptions,
        csv: () =>
          scatterCsv(view.points, { title: chartTitle, basisYear: view.basisYear }),
      }
    : null;
  // Embedded, the host card's menu downloads this chart
  useEffect(() => {
    if (onDownload) onDownload(download);
    // The download changes with what it describes, not with every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDownload, ready, view, description, chartTitle, exportName]);
  // Households keep their basis-year band in every year (the y axis does
  // not move with the year), so the title names no year; About this chart
  // and the tooltip give the basis year
  const incomeTitle = "Household net income under current law (£k)";
  // The key: in the sentence, with the logo in the SVG as on the decile
  // card; with the reader's household, a key row under the plot and the
  // logo below it. A note instead of a plot keeps the logo row.
  const keyRow = ready && !noDots && Boolean(youShown);
  const svgLogo = !embedded && !youShown;
  const htmlLogo = !embedded && (Boolean(youShown) || noDots);

  // Beside a household's result, a selection the chart is not published
  // for gets the reason in a line, not an empty plot
  if ((you || embedded) && view.kind === "notice") {
    const reason = [view.reason, view.detail].filter(Boolean).join(" ");
    if (embedded) {
      return (
        <div className="household-scatter-template is-embedded household-scatter-you-notice">
          <p className="chart-description" role="status">
            {reason}
          </p>
        </div>
      );
    }
    return (
      <div className="household-scatter-template household-scatter-you-notice">
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="dots" />
              <span className="title-text">
                <NoBreakYear text={chartTitle} />
              </span>
            </h3>
            <p className="chart-description" role="status">
              {reason}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // On its own, a selection the chart is not published for gets the
  // reason in a compact panel under the title, not an empty plot
  if (view.kind === "notice") {
    return (
      <div className="household-scatter-template household-scatter-empty-card">
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="dots" />
              <span className="title-text">
                <NoBreakYear text={chartTitle} />
              </span>
            </h3>
            <p className="chart-description">{DESCRIPTION_LOADING}</p>
          </div>
        </div>
        <div className="chart-plot">
          <div className="plot-empty household-scatter-empty" role="status">
            <div>
              <p className="household-scatter-empty-reason">{view.reason}</p>
              {view.detail && <p className="household-scatter-empty-detail">{view.detail}</p>}
              {view.choices && onPoliciesSet && (
                <div className="household-scatter-empty-actions">
                  <button type="button" className="light-pill-button" onClick={() => onPoliciesSet(view.choices.all)}>
                    {showAllLabel(view.choices.all.length)}
                  </button>
                  <button type="button" className="light-pill-button" onClick={() => onPoliciesSet([view.choices.alone])}>
                    {showAloneLabel((policies ?? []).find((policy) => policy.id === view.choices.alone)?.name ?? view.choices.alone)}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`household-scatter-template${embedded ? " is-embedded" : ""}`}>
      {embedded ? (
        <p className="chart-description">{description}</p>
      ) : (
        <div className="chart-header">
          <div>
            <h3>
              <TitleIcon name="dots" />
              <span className="title-text">
                <NoBreakYear text={chartTitle} />
              </span>
            </h3>
            <p className="chart-description">
              {ready && !youShown && !noDots ? describeWithKey(householdsPerDot(view.basisPoints)) : description}
              {descriptionLink && <> {descriptionLink}</>}
            </p>
          </div>
          <ChartDownloadMenu
            download={download}
            chartTitle={chartTitle}
            disabledReason={ready ? undefined : "Available when results are published"}
          />
        </div>
      )}

      {/* The plot takes the rows the map beside it uses for its controls,
          map and colour scale, so the two cards line up and fill alike */}
      <div className="chart-plot household-scatter-template-plot">
        <div className="household-scatter-template-canvas" ref={chartRef}>
          {noDots ? (
            <div className="plot-empty household-scatter-no-change" role="status">
              <p>{changesWithheld ? HOUSEHOLDS_WITHHELD_NOTE : noHouseholdChange(yearLabel)}</p>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={STACKED_HEIGHT / 2}>
            <ScatterChart
              margin={{
                top: chartMargin(narrow).top,
                right: narrow ? 22 : 20,
                left: 0,
                bottom: svgLogo ? LOGO_ROOM : 0,
              }}
            >
              <CartesianGrid {...GRID} />
              <XAxis
                type="number"
                dataKey="change"
                name="Income change"
                domain={changeAxis.domain}
                allowDataOverflow
                ticks={changeAxis.ticks}
                interval={0}
                tickFormatter={changeTick}
                tick={TICK}
                height={44}
                label={{
                  value: "Net income change (£ a year)",
                  position: "insideBottom",
                  offset: 2,
                  style: AXIS_TITLE,
                }}
              />
              <YAxis
                type="number"
                dataKey="income"
                name="Baseline income"
                domain={INCOME_AXIS_DOMAIN}
                allowDataOverflow
                ticks={INCOME_TICKS}
                interval={0}
                tickFormatter={thousands}
                tick={TICK}
                width={narrow ? 30 + Y_TITLE_GUTTER : 44 + Y_TITLE_GUTTER}
              />
              <ReferenceLine x={0} stroke={CHART_COLOURS.zeroLine} strokeWidth={2} />
              <Customized component={<DotLayer dots={shown} onHover={onHover} />} />
              {youShown && (
                <Customized
                  component={<YouLayer you={youShown} changeDomain={changeAxis.domain} />}
                />
              )}
              <Customized component={<ChartUnitLabel text={incomeTitle} />} />
              {svgLogo && <Customized component={PolicyEngineLogo} />}
            </ScatterChart>
          </ResponsiveContainer>
          )}
        </div>
        {ready && !noDots && (
          <GroupTooltip
            hover={hover}
            basisLabel={basisLabel}
            yearLabel={yearLabel}
          />
        )}
        {/* While loading, the chart's grey template is the placeholder */}
        {view.kind === "loading" && (
          <span className="visually-hidden" role="status">Loading household results…</span>
        )}
        {!ready && view.kind !== "loading" && (
          <div className="household-scatter-template-note" role="status">
            <p>{view.reason}</p>
            {view.detail && <p className="household-scatter-template-detail">{view.detail}</p>}
          </div>
        )}
      </div>

      {keyRow && (
        <ul className="scatter-legend chart-legend" aria-label="Key">
          {key.map((item) => (
            <li key={item.label}>
              <span
                className={`scatter-legend-dot${item === YOU_KEY ? " scatter-legend-you" : ""}`}
                style={item === YOU_KEY ? undefined : { background: item.color }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      {htmlLogo && (
        <div className="chart-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CHART_LOGO.href} alt="PolicyEngine" />
        </div>
      )}

      {/* At the card's foot, under the logo, as on every card */}
      {ready && !embedded && <ScatterMoreInfo basisLabel={basisLabel} />}
    </div>
  );
}

export default HouseholdScatter;
