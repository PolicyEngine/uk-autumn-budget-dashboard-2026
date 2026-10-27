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
    return `Taken together, the lowest-income tenth ${percentVerb(low)}, and the highest-income tenth ${percentVerb(high).replace(" of its net income", "")}.`;
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

// "Later years differ" (ideas issue, 27 October): a short pointer when a
// later year turns the selected year's picture round, as when a measure
// that costs money now raises it at the end of the forecast. It names the
// year and the direction only, never a figure: each later year's own
// sentence says how much, when the reader moves the year.
//
// Only a real turn counts (second-pass review, 27 October): a gain becoming
// a loss or the other way, or a clear effect appearing from almost no
// change, as with the threshold freeze. The later effect must be clear,
// so a measure ending or fading, or a creep from about £1 to £6, says
// nothing.

/** A clear decile effect: at least two of the sentence's rounding steps. */
export const CLEAR_DECILE_CHANGE = { absolute: 20, relative: 0.2 };
/** A clear revenue effect, £bn: twice the "roughly balance" band. */
export const CLEAR_REVENUE_CHANGE = 0.1;

/** A decile end, rounded as the decile sentence rounds it. */
function decileRounded(v, kind) {
  return kind === "relative" ? Math.round(v * 10) / 10 : Math.round(v / 10) * 10;
}

const sign = (r) => (r > 0 ? "gain" : r < 0 ? "loss" : "none");

/**
 * The direction a later value turns to, or null when it is no turn: the
 * later value must be clear, and either the opposite of the selected one
 * or a change from almost none.
 */
function turnTo(wasRounded, nowRounded, clear) {
  if (Math.abs(nowRounded) < clear - 1e-9) return null;
  const was = sign(wasRounded);
  const now = sign(nowRounded);
  return was === "none" || was !== now ? now : null;
}

const TENTH_VERB = {
  one: { gain: "gains", loss: "loses" },
  both: { gain: "gain", loss: "lose" },
};

/**
 * The decile pair's pointer: the first later year in which the lowest- or
 * highest-income tenth turns from a gain to a clear loss, the other way,
 * or from almost no change to a clear gain or loss (CLEAR_DECILE_CHANGE,
 * on the values as the sentence rounds them).
 *
 * @param {{low: number, high: number}|null} selected - The ends in the selected year
 * @param {Array<{yearLabel: string, low: number, high: number}>} later - Later years, in order
 * @param {"absolute"|"relative"} kind
 * @returns {string|null}
 */
export function laterDecileNote(selected, later, kind) {
  const usable = (ends) => ends && [ends.low, ends.high].every((v) => v != null && Number.isFinite(v));
  if (!usable(selected)) return null;
  const clear = CLEAR_DECILE_CHANGE[kind === "relative" ? "relative" : "absolute"];
  for (const ends of later ?? []) {
    if (!usable(ends)) continue;
    const low = turnTo(decileRounded(selected.low, kind), decileRounded(ends.low, kind), clear);
    const high = turnTo(decileRounded(selected.high, kind), decileRounded(ends.high, kind), clear);
    if (!low && !high) continue;
    let what;
    if (low && high && low === high) {
      what = `both the lowest- and highest-income tenths ${TENTH_VERB.both[low]}`;
    } else {
      what = [
        low && `the lowest-income tenth ${TENTH_VERB.one[low]}`,
        high && `the highest-income tenth ${TENTH_VERB.one[high]}`,
      ]
        .filter(Boolean)
        .join(" and ");
    }
    return `Later years differ: in ${ends.yearLabel}, ${what}.`;
  }
  return null;
}

const REVENUE_WORDS = {
  gain: "raise revenue",
  loss: "cost revenue",
};

/** Revenue within the revenue sentence's "roughly balance" band reads as none. */
const revenueRounded = (net) => (Math.abs(net) < 0.05 ? 0 : net);

/**
 * The revenue chart's pointer: the first later year in which the selected
 * measures turn from costing revenue to clearly raising it, the other way,
 * or from roughly balancing to a clear effect (CLEAR_REVENUE_CHANGE).
 *
 * @param {number|null} net - The selected year's net effect (£bn)
 * @param {Array<{yearLabel: string, net: number|null}>} later - Later years, in order
 * @returns {string|null}
 */
export function laterRevenueNote(net, later) {
  if (net == null || !Number.isFinite(net)) return null;
  for (const point of later ?? []) {
    if (point.net == null || !Number.isFinite(point.net)) continue;
    const now = turnTo(revenueRounded(net), revenueRounded(point.net), CLEAR_REVENUE_CHANGE);
    if (now) return `Later years differ: in ${point.yearLabel}, the selected measures ${REVENUE_WORDS[now]}.`;
  }
  return null;
}
