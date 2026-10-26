// One short plain sentence per chart card (Vahid, 26 October): the
// finding with its number; definitions sit in each card's More info.

const gbp = (v) => `£${Math.round(Math.abs(v)).toLocaleString("en-GB")}`;
const pounds10 = (v) => gbp(Math.round(v / 10) * 10);

/** "gains £120 a year" / "loses £40 a year" / "sees no change". */
function poundsVerb(v, unit) {
  const r = Math.round(v / 10) * 10;
  if (r === 0) return "sees almost no change";
  return `${r > 0 ? "gains" : "loses"} about ${pounds10(v)}${unit}`;
}

/** "gains 0.7%" / "loses 0.2%" / "sees almost no change". */
function percentVerb(v) {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "sees almost no change";
  return `${r > 0 ? "gains" : "loses"} ${Math.abs(r).toFixed(1)}% of its net income`;
}

/**
 * The decile pair's line: the lowest- and highest-income tenths, in £ a year
 * (absolute) or as a share of net income (relative); null without both ends.
 */
export function decileSentence(data, kind) {
  const ends = [data?.[0]?.netChange, data?.[data.length - 1]?.netChange];
  if (ends.some((v) => v == null || !Number.isFinite(v))) return null;
  const [low, high] = ends;
  if (kind === "relative") {
    return `On average the lowest-income tenth ${percentVerb(low)}, and the highest-income tenth ${percentVerb(high).replace(" of its net income", "")}.`;
  }
  return `On average the lowest-income tenth ${poundsVerb(low, " a year")}, and the highest-income tenth ${poundsVerb(high, "")}.`;
}

/** The revenue chart's line for the selected year; null without a figure. */
export function revenueSentence(net, yearLabel) {
  if (net == null || !Number.isFinite(net)) return null;
  const bn = Math.abs(net) >= 0.95 ? `£${Math.abs(net).toFixed(1)} billion` : `£${Math.round(Math.abs(net) * 1000).toLocaleString("en-GB")} million`;
  // Exactly nothing (a measure not in force that year) is not "roughly balance"
  if (Math.abs(net) < 0.0005) return `In ${yearLabel}, the selected measures change no revenue.`;
  if (Math.abs(net) < 0.05) return `In ${yearLabel}, the selected measures roughly balance: they neither raise nor cost much revenue.`;
  return net > 0
    ? `In ${yearLabel}, the selected measures raise ${bn} for the government.`
    : `In ${yearLabel}, the selected measures cost the government ${bn}.`;
}
