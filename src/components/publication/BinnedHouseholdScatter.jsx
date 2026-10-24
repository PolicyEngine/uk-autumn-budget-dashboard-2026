import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { PROVISIONAL_LABEL } from "../../utils/publication/manifest";
import {
  bandLabel,
  CHANGE_MAX,
  CHANGE_MIN,
  changeBandLabel,
  changeKind,
  openEdge,
  SCATTER_BINS,
  toChangeAxis,
} from "../../utils/publication/scatter";
import UnavailableNotice from "./UnavailableNotice";
import "./publication.css";

const pounds = (value) =>
  `${value < 0 ? "−" : ""}£${new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.abs(value))}`;
const thousands = (value) =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value / 1000)}k`;

const COLOURS = { loss: "#D97706", gain: "#319795", zero: "#9CA3AF" };

// Losses amber, gains teal; the no-change band, (−£1, £1), grey.
export function colourFor(point) {
  return COLOURS[changeKind(point.changeBand, point.changeBandUpper)];
}

// Change ticks on the symlog axis, in £, and the open bands' place beyond
// ±£5,000.
const CHANGE_TICKS = [-5000, -1000, -250, -50, 0, 50, 250, 1000, 5000];
const OPEN_BAND_OFFSET = 0.2;
const changePosition = (point) => {
  const edge = openEdge(point.changeBand, point.changeBandUpper);
  const position = toChangeAxis(point.change);
  if (edge === "upper") return position + OPEN_BAND_OFFSET;
  if (edge === "lower") return position - OPEN_BAND_OFFSET;
  return position;
};
const CHANGE_DOMAIN = [
  toChangeAxis(CHANGE_MIN) - 2 * OPEN_BAND_OFFSET,
  toChangeAxis(CHANGE_MAX) + 2 * OPEN_BAND_OFFSET,
];
const tickPounds = new Map(CHANGE_TICKS.map((value) => [toChangeAxis(value), value]));

function CellTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const bins = SCATTER_BINS;
  return (
    <div className="publication-tooltip">
      <p>
        Baseline income{" "}
        {bandLabel(
          point.incomeBand,
          bins.income_band_width,
          bins.income_min,
          bins.income_max,
          pounds,
        )}
      </p>
      <p>
        Change a year:{" "}
        {changeBandLabel(point.changeBand, point.changeBandUpper, pounds)}
      </p>
      <p>{thousands(point.households)} households</p>
    </div>
  );
}

/**
 * Households by baseline income and income change, from binned cells.
 * Each bubble is one cell; its area shows how many households it holds.
 * The change axis is symlog, so the narrow bands near zero and the wide
 * ones both read; the open bands beyond ±£5,000 sit just beyond that edge.
 *
 * @param {{series: Object}} props - The result of `scatterSeries`.
 */
function BinnedHouseholdScatter({ series }) {
  if (series.status !== "available") {
    return <UnavailableNotice reason={series.reason} />;
  }
  const points = series.points.map((point) => ({
    ...point,
    y: changePosition(point),
    fill: colourFor(point),
  }));
  return (
    <div className="publication-scatter">
      {series.provisional && (
        <p className="publication-provisional">{PROVISIONAL_LABEL}</p>
      )}
      <ResponsiveContainer width="100%" height={350}>
        <ScatterChart margin={{ top: 20, right: 30, left: 90, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            type="number"
            dataKey="income"
            name="Baseline income"
            domain={[SCATTER_BINS.income_min, SCATTER_BINS.income_max]}
            tickFormatter={(value) => `£${value / 1000}k`}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Income change"
            domain={CHANGE_DOMAIN}
            ticks={[...tickPounds.keys()]}
            interval={0}
            tickFormatter={(value) => {
              const amount = tickPounds.get(value) ?? 0;
              if (amount >= CHANGE_MAX) return `≥ ${pounds(amount)}`;
              if (amount <= CHANGE_MIN) return `≤ ${pounds(amount)}`;
              return pounds(amount);
            }}
            label={{
              value: "Change in household net income (£ a year)",
              angle: -90,
              position: "insideLeft",
              dx: -30,
              style: { textAnchor: "middle" },
            }}
          />
          <ZAxis type="number" dataKey="households" range={[20, 400]} />
          <ReferenceLine y={0} stroke="#9CA3AF" />
          <Tooltip content={<CellTooltip />} />
          <Scatter data={points} shape="circle" isAnimationActive={false}>
            {points.map((point) => (
              <Cell
                key={`${point.incomeBand}:${point.changeBand}:${point.changeBandUpper}`}
                fill={point.fill}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <p className="publication-note">
        Each bubble is a group of households with similar baseline incomes and
        income changes; its size shows how many. Groups with fewer than{" "}
        {SCATTER_BINS.min_households} surveyed households are not shown, and the
        outer bands include everything beyond them.
      </p>
    </div>
  );
}

export default BinnedHouseholdScatter;
