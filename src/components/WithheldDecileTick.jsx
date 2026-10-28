import { TICK_STYLE } from "../utils/chartTheme";
import { WITHHELD_DECILE_MESSAGE } from "../utils/decileWithholding";

/** Mark withheld deciles at their axis position, with the reason on hover. */
export default function WithheldDecileTick({ x, y, payload, withheldDeciles }) {
  const withheld = withheldDeciles.has(String(payload.value));
  return (
    <g transform={`translate(${x},${y})`}>
      {withheld && <title>{WITHHELD_DECILE_MESSAGE}</title>}
      <text dy={16} textAnchor="middle" {...TICK_STYLE}>
        {String(payload.value).replace(/st|nd|rd|th/g, "")}{withheld ? " *" : ""}
      </text>
    </g>
  );
}
