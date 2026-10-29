// One short plain sentence per chart card (Vahid, 26 October): the
// finding with its number; definitions sit in each card's About this chart.

import { formatBnOrM } from "./moneyFormat";

const gbp = (v) => `£${Math.round(Math.abs(v)).toLocaleString("en-GB")}`;

/** A decile end as the sentence rounds it: £10 steps, or 0.1% of net income. */
function decileRounded(v, kind) {
  return kind === "relative" ? Math.round(v * 10) / 10 : Math.round(v / 10) * 10;
}

/** "about £20" / "0.3%": the rounded size, without its sign. */
function decileAmount(r, kind) {
  return kind === "relative" ? `${Math.abs(r).toFixed(1)}%` : `about ${gbp(r)}`;
}

const DECILE_UNIT = { absolute: " a year", relative: " of net income" };

/**
 * The decile pair's line (Vahid, 27 October: shorter): the lowest- and
 * highest-income tenths, in £ a year (absolute) or as a share of net income
 * (relative), with the later-year turn (laterDecileNote) as its second
 * clause. The unit is said once, on the first figure; a verb the two ends
 * share is said once too. Null without both ends.
 *
 * @param {Array<{netChange: number}>} data - Deciles, lowest first
 * @param {"absolute"|"relative"} kind
 * @param {string|null} [later] - laterDecileNote's clause, e.g. "in 2031-32 the highest loses"
 */
export function decileSentence(data, kind, later = null) {
  const ends = [data?.[0]?.netChange, data?.[data.length - 1]?.netChange];
  if (ends.some((v) => v == null || !Number.isFinite(v))) return null;
  const k = kind === "relative" ? "relative" : "absolute";
  const [low, high] = ends.map((v) => decileRounded(v, k));
  const unit = DECILE_UNIT[k];
  let first;
  if (low === 0 && high === 0) {
    first = "The lowest- and highest-income tenths see almost no change";
  } else if (low === high) {
    first = `The lowest- and highest-income tenths each ${low > 0 ? "gain" : "lose"} ${decileAmount(low, k)}${unit}`;
  } else if (low === 0) {
    first = `The lowest-income tenth sees almost no change and the highest ${high > 0 ? "gains" : "loses"} ${decileAmount(high, k)}${unit}`;
  } else {
    const verb = low > 0 ? "gains" : "loses";
    const highPart =
      high === 0 ? "almost nothing" : `${Math.sign(high) === Math.sign(low) ? "" : `${high > 0 ? "gains" : "loses"} `}${decileAmount(high, k)}`;
    first = `The lowest-income tenth ${verb} ${decileAmount(low, k)}${unit} and the highest ${highPart}`;
  }
  return later ? `${first}; ${later}.` : `${first}.`;
}

/** The revenue chart's line for the selected year; null without a figure. */
export function revenueSentence(net, yearLabel) {
  if (net == null || !Number.isFinite(net)) return null;
  // The chart's own rounding (moneyFormat: £m to the nearest £5m under
  // £1bn, £bn to one decimal), in words, so text and tooltip agree
  const bn = formatBnOrM(Math.abs(net)).replace(/m$/, " million").replace(/bn$/, " billion");
  // Exactly nothing (a measure not in force that year) is not "roughly balance"
  if (Math.abs(net) < 0.0005) return `In ${yearLabel}, the selected policies change no revenue.`;
  if (Math.abs(net) < 0.05) return `In ${yearLabel}, the selected policies roughly balance: they neither raise nor cost much revenue.`;
  return net > 0
    ? `In ${yearLabel}, the selected policies raise ${bn} for the government.`
    : `In ${yearLabel}, the selected policies cost the government ${bn}.`;
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
//
// The year it names is the first whose own sentence shows the turn, even
// where that year's effect is not yet clear (coordinator, 29 October): the
// whole package's highest-income tenth gains about £100 in 2026-27, loses
// about £10 in 2027-28 and about £50 in 2028-29, so 2026-27 points to
// 2027-28, whose sentence already says it loses, not to 2028-29.

/** A clear decile effect: at least two of the sentence's rounding steps. */
export const CLEAR_DECILE_CHANGE = { absolute: 20, relative: 0.2 };
/** A clear revenue effect, £bn: twice the "roughly balance" band. */
export const CLEAR_REVENUE_CHANGE = 0.1;

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

/**
 * The later point to name, and what turns there. The first point with a
 * clear turn (turnTo) in any series says there is one; each series that
 * turns there is then dated to the first point whose own sentence shows
 * that direction (its rounded value's sign), so no earlier point's sentence
 * says it first. The earliest of those dates is named, with the series that
 * turn by it. Null without a clear turn.
 *
 * @param {Object<string, number>} was - Each series' selected value, rounded as its sentence rounds it
 * @param {Array<Object>} points - Later points, in order, each with every series' raw value
 * @param {(value: number) => number} rounded - The sentence's rounding
 * @param {number} clear - The size a turn must reach (CLEAR_DECILE_CHANGE, CLEAR_REVENUE_CHANGE)
 * @returns {{point: Object, turns: Object<string, "gain"|"loss">}|null}
 */
function firstShownTurn(was, points, rounded, clear) {
  const series = Object.keys(was);
  const at = points.findIndex((point) => series.some((key) => turnTo(was[key], rounded(point[key]), clear)));
  if (at < 0) return null;
  const dated = series.flatMap((key) => {
    const now = turnTo(was[key], rounded(points[at][key]), clear);
    return now ? [{ key, now, index: points.findIndex((point) => sign(rounded(point[key])) === now) }] : [];
  });
  const index = Math.min(...dated.map((turn) => turn.index));
  return {
    point: points[index],
    turns: Object.fromEntries(dated.filter((turn) => turn.index === index).map(({ key, now }) => [key, now])),
  };
}

const TENTH_VERB = {
  one: { gain: "gains", loss: "loses" },
  both: { gain: "gain", loss: "lose" },
};

/**
 * The decile pair's pointer: the first later year in which the lowest- or
 * highest-income tenth turns from a gain to a loss, the other way, or from
 * almost no change to a gain or loss, as that year's own sentence says it,
 * provided the turn becomes clear by some later year (CLEAR_DECILE_CHANGE,
 * on the values as the sentence rounds them; firstShownTurn). Returns the clause the
 * decile sentence ends on, e.g. "in 2031-32 the highest loses"; with
 * standalone, a sentence of its own that names the tenths in full, for a
 * card with no decile line to hang it on (nothing changes this year).
 *
 * @param {{low: number, high: number}|null} selected - The ends in the selected year
 * @param {Array<{yearLabel: string, low: number, high: number}>} later - Later years, in order
 * @param {"absolute"|"relative"} kind
 * @param {{standalone?: boolean}} [options]
 * @returns {string|null}
 */
export function laterDecileNote(selected, later, kind, { standalone = false } = {}) {
  const usable = (ends) => ends && [ends.low, ends.high].every((v) => v != null && Number.isFinite(v));
  if (!usable(selected)) return null;
  const clear = CLEAR_DECILE_CHANGE[kind === "relative" ? "relative" : "absolute"];
  const rounded = (value) => decileRounded(value, kind);
  // A later year without both ends is skipped, not read as a turn
  const turn = firstShownTurn(
    { low: rounded(selected.low), high: rounded(selected.high) },
    (later ?? []).filter(usable),
    rounded,
    clear,
  );
  if (!turn) return null;
  const { low, high } = turn.turns;
  let what;
  if (low && high && low === high) {
    what = `both ${standalone ? "the lowest- and highest-income tenths " : ""}${TENTH_VERB.both[low]}`;
  } else {
    what = [
      low && `the lowest${standalone ? "-income tenth" : ""} ${TENTH_VERB.one[low]}`,
      high && `the highest${standalone ? "-income tenth" : ""} ${TENTH_VERB.one[high]}`,
    ]
      .filter(Boolean)
      .join(" and ");
  }
  const { yearLabel } = turn.point;
  return standalone ? `Later years differ: in ${yearLabel}, ${what}.` : `in ${yearLabel} ${what}`;
}

const REVENUE_WORDS = {
  gain: "raise revenue",
  loss: "cost revenue",
};

/** Revenue within the revenue sentence's "roughly balance" band reads as none. */
const revenueRounded = (net) => (Math.abs(net) < 0.05 ? 0 : net);

/**
 * The revenue chart's pointer: the first later year in which the selected
 * measures turn from costing revenue to raising it, the other way, or from
 * roughly balancing to an effect, as that year's own sentence says it,
 * provided the turn becomes clear by some later year (CLEAR_REVENUE_CHANGE;
 * firstShownTurn).
 *
 * @param {number|null} net - The selected year's net effect (£bn)
 * @param {Array<{yearLabel: string, net: number|null}>} later - Later years, in order
 * @returns {string|null}
 */
export function laterRevenueNote(net, later) {
  if (net == null || !Number.isFinite(net)) return null;
  const points = (later ?? []).filter((point) => point.net != null && Number.isFinite(point.net));
  const turn = firstShownTurn({ net: revenueRounded(net) }, points, revenueRounded, CLEAR_REVENUE_CHANGE);
  return turn ? `Later years differ: in ${turn.point.yearLabel}, the selected policies ${REVENUE_WORDS[turn.turns.net]}.` : null;
}
