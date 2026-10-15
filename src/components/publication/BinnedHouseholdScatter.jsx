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
import { bandLabel, SCATTER_BINS } from "../../utils/publication/scatter";
import UnavailableNotice from "./UnavailableNotice";
import "./publication.css";

const pounds = (value) =>
  `£${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value)}`;
const thousands = (value) =>
  `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value / 1000)}k`;

// Losses amber, gains teal; the band holding zero (£0 to £100) grey.
export function colourFor(point) {
  if (point.changeBand + SCATTER_BINS.change_band_width <= 0) return "#D97706";
  if (point.changeBand > 0) return "#319795";
  return "#9CA3AF";
}

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
        Change{" "}
        {bandLabel(
          point.changeBand,
          bins.change_band_width,
          bins.change_min,
          bins.change_max,
          pounds,
        )}{" "}
        a year
      </p>
      <p>{thousands(point.households)} households</p>
    </div>
  );
}

/**
 * Households by baseline income and income change, from binned cells.
 * Each bubble is one cell; its area shows how many households it holds.
 *
 * @param {{series: Object}} props - The result of `scatterSeries`.
 */
function BinnedHouseholdScatter({ series }) {
  if (series.status !== "available") {
    return <UnavailableNotice reason={series.reason} />;
  }
  const points = series.points.map((point) => ({
    ...point,
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
            dataKey="change"
            name="Income change"
            domain={[SCATTER_BINS.change_min, SCATTER_BINS.change_max]}
            tickFormatter={pounds}
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
                key={`${point.incomeBand}:${point.changeBand}`}
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
