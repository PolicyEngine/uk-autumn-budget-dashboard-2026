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
  if (Math.abs(net) < 0.05) return `In ${yearLabel}, the selected measures roughly balance: they neither raise nor cost much revenue.`;
  return net > 0
    ? `In ${yearLabel}, the selected measures raise ${bn} for the government.`
    : `In ${yearLabel}, the selected measures cost the government ${bn}.`;
}

// "Later years differ" (ideas issue, 27 October): a short pointer when a
// later year turns the selected year's picture round, as when a measure
// that costs money now raises it at the end of the forecast. It names the
// year and the direction only, never a figure: each later year's own
// sentence says how much, when the reader moves the year.

/** A decile end's direction, rounded as the decile sentence rounds it. */
function decileDirection(v, kind) {
  const r = kind === "relative" ? Math.round(v * 10) / 10 : Math.round(v / 10) * 10;
  return r > 0 ? "gain" : r < 0 ? "loss" : "none";
}

const TENTH_VERB = {
  one: { gain: "gains", loss: "loses", none: "sees almost no change" },
  both: { gain: "gain", loss: "lose", none: "see almost no change" },
};

/**
 * The decile pair's pointer: the first later year in which the lowest- or
 * highest-income tenth moves in another direction from the selected year
 * (gain, loss or almost no change, rounded as the sentence rounds them).
 *
 * @param {{low: number, high: number}|null} selected - The ends in the selected year
 * @param {Array<{yearLabel: string, low: number, high: number}>} later - Later years, in order
 * @param {"absolute"|"relative"} kind
 * @returns {string|null}
 */
export function laterDecileNote(selected, later, kind) {
  const usable = (ends) => ends && [ends.low, ends.high].every((v) => v != null && Number.isFinite(v));
  if (!usable(selected)) return null;
  const was = { low: decileDirection(selected.low, kind), high: decileDirection(selected.high, kind) };
  for (const ends of later ?? []) {
    if (!usable(ends)) continue;
    const now = { low: decileDirection(ends.low, kind), high: decileDirection(ends.high, kind) };
    const lowTurns = now.low !== was.low;
    const highTurns = now.high !== was.high;
    if (!lowTurns && !highTurns) continue;
    let what;
    if (lowTurns && highTurns && now.low === now.high) {
      what = `both the lowest- and highest-income tenths ${TENTH_VERB.both[now.low]}`;
    } else {
      what = [
        lowTurns && `the lowest-income tenth ${TENTH_VERB.one[now.low]}`,
        highTurns && `the highest-income tenth ${TENTH_VERB.one[now.high]}`,
      ]
        .filter(Boolean)
        .join(" and ");
    }
    return `Later years differ: in ${ends.yearLabel}, ${what}.`;
  }
  return null;
}

/** The revenue's direction, as the revenue sentence reads it. */
function revenueDirection(net) {
  if (Math.abs(net) < 0.05) return "none";
  return net > 0 ? "raise" : "cost";
}

const REVENUE_WORDS = {
  raise: "raise revenue",
  cost: "cost revenue",
  none: "roughly balance",
};

/**
 * The revenue chart's pointer: the first later year in which the selected
 * measures turn from costing revenue to raising it, or the other way, or
 * to roughly balancing.
 *
 * @param {number|null} net - The selected year's net effect (£bn)
 * @param {Array<{yearLabel: string, net: number|null}>} later - Later years, in order
 * @returns {string|null}
 */
export function laterRevenueNote(net, later) {
  if (net == null || !Number.isFinite(net)) return null;
  const was = revenueDirection(net);
  for (const point of later ?? []) {
    if (point.net == null || !Number.isFinite(point.net)) continue;
    const now = revenueDirection(point.net);
    if (now !== was) return `Later years differ: in ${point.yearLabel}, the selected measures ${REVENUE_WORDS[now]}.`;
  }
  return null;
}
