import { useEffect, useRef, useState } from "react";
import { withCalculatorOnly } from "../utils/calculatorOnlyMeasures";
import { SELECTABLE_YEARS } from "../utils/displayYears";
import {
  HEADLINE_INCLUDE,
  buildHouseholdRequest,
  engineDifferences,
  householdApiUrl,
  normaliseHouseholdImpact,
  postHouseholdDetail,
  requestKey,
} from "../utils/householdImpactApi";
import { peekHouseholdImpact, rememberHouseholdHeadline } from "./useHouseholdImpact";

/**
 * The example cards' figures when the precomputed file does not answer them
 * (the published measures, the selection or the engine differ from the
 * file's): each example's headline, its change in net income with the
 * selected measures, asked of the household API in the background for every
 * year a reader can choose, so its card shows a figure and a bar for each
 * year without being chosen.
 *
 * - The year shown first: all eight examples for the year chosen, then the
 *   other years for the bars (8 examples x 5 years: at most 40 headline
 *   requests, each two runs, only when the file does not answer).
 * - At most EXAMPLE_FILL_CONCURRENCY requests at once; each goes to the
 *   detail URL (Modal) when the build has one, else the main API, never both.
 * - Each answer goes in the session cache the calculator reads (its headline
 *   only, so choosing the card shows it at once while its details load) and
 *   in sessionStorage (its net income and engine, nothing else), so a
 *   revisit asks nothing. An answer from other package versions than
 *   `expectedEngine` is refused and never stored.
 * - A change of selection or publication, or unmounting, aborts every
 *   request still out; a change of year only reorders what is still to ask.
 */

/** The most requests the background fill has out at once. */
export const EXAMPLE_FILL_CONCURRENCY = 4;

// sessionStorage, by the calculator's own cache key
const STORE_PREFIX = "ab2026:example-headline:v1:";

/** A stored headline ({ net, engine }) for `key`, or null (missing, unreadable or another engine's). */
export function readStoredHeadline(key, expectedEngine = null) {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.net || !Number.isFinite(Number(value.net.change))) return null;
    if (expectedEngine && engineDifferences(expectedEngine, value.engine).length) return null;
    return value;
  } catch {
    return null;
  }
}

function storeHeadline(key, value) {
  try {
    globalThis.sessionStorage?.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the session cache still has it
  }
}

/** A stored list of measure ids, kept only if every id is in `within`. */
function readStoredList(key, within) {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(key) ?? "null");
    return Array.isArray(value) && value.length > 0 && value.every((id) => within.includes(id)) ? value : null;
  } catch {
    return null;
  }
}

function storeList(key, list) {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(list));
  } catch {
    // Not kept: the next visit asks once more
  }
}

/**
 * The measures a refusal names as unknown to the API (its 422: "Unknown
 * measures: a, b" on `policies`), or null for any other error.
 */
export function unknownMeasures(error) {
  const messages = [error?.message ?? "", ...(error?.fields ?? []).map((field) => field?.message ?? "")];
  for (const message of messages) {
    const match = /Unknown measures?:\s*([^"\]]+)/.exec(message);
    if (match) {
      const ids = match[1].split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length) return ids;
    }
  }
  return null;
}

class UnknownMeasuresError extends Error {
  constructor(unknown) {
    super(`Unknown measures: ${unknown.join(", ")}`);
    this.unknown = unknown;
  }
}

/**
 * Run `tasks` (functions returning promises), at most `limit` at once, in
 * order; none is started once `signal` is aborted. Each task handles its
 * own failure.
 */
export async function runLimited(tasks, limit, signal) {
  let next = 0;
  const worker = async () => {
    while (!signal?.aborted && next < tasks.length) {
      const task = tasks[next];
      next += 1;
      try {
        await task();
      } catch {
        // A task's own failure is recorded by the task
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/** The calculator's cache key for an example's headline in `year`. */
export const exampleKey = (inputs, { year, policies, publicationKey = "" }) =>
  `${publicationKey}:${requestKey(buildHouseholdRequest(inputs, { year, policies }))}`;

/**
 * @param {Object} params
 * @param {Array<{id: string, inputs: Object}>} params.examples - Each example's id and full answers
 * @param {string[]} params.policies - The selected measures
 * @param {number} params.year - The year chosen (asked first)
 * @param {boolean} params.enabled - Fill only while true (the file does not answer, the view is shown)
 * @param {string} [params.publicationKey]
 * @param {Object|null} [params.expectedEngine]
 * @param {(snapshot: string) => Promise<boolean>} [params.confirmPublication]
 * @param {Function} [params.post] - The request (tests pass their own)
 * @returns {{ figures: Object, pending: Set<string>, failed: Set<string>, reduced: string[]|null }}
 *   figures as { [id]: { [year]: { change, before, after } } }; pending and
 *   failed as "id:year"; reduced, the measures asked with when the API did
 *   not know every selected one (null when it knew them all)
 */
export default function useExampleFigures({
  examples,
  policies,
  year,
  enabled,
  publicationKey = "",
  expectedEngine = null,
  confirmPublication = null,
  post = postHouseholdDetail,
}) {
  const [state, setState] = useState({ key: null, figures: {}, pending: new Set(), failed: new Set(), reduced: null });
  // The year is read when the queue is ordered, not a reason to start again
  const yearRef = useRef(year);
  yearRef.current = year;
  const selectionKey = policies.join(",");
  const engineKey = JSON.stringify(expectedEngine);
  const runKey = `${publicationKey}|${selectionKey}|${engineKey}`;
  const active = enabled && policies.length > 0 && householdApiUrl() !== null;

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    // The measures asked with: the selection, less any the API does not know
    // (remembered for the session, so a revisit asks with them at once)
    const supportedKey = `${STORE_PREFIX}supported:${publicationKey}|${selectionKey}`;
    let used = readStoredList(supportedKey, policies) ?? policies;
    let figures = {};
    const pending = new Set();
    const failed = new Set();
    const put = (id, y, net) => {
      (figures[id] ??= {})[y] = { change: net.change, before: net.before, after: net.after };
    };
    const publish = () => {
      if (!signal.aborted) {
        setState({
          key: runKey,
          figures: structuredClone(figures),
          pending: new Set(pending),
          failed: new Set(failed),
          reduced: used.length < policies.length ? used : null,
        });
      }
    };
    // Every cell the session does not already have, the year chosen first;
    // what it has is shown at once
    const plan = () => {
      figures = {};
      pending.clear();
      const chosen = yearRef.current;
      const years = [chosen, ...SELECTABLE_YEARS.filter((y) => y !== chosen)].filter((y) => SELECTABLE_YEARS.includes(y));
      const asks = [];
      for (const y of years) {
        for (const example of examples) {
          // An example that turns on a calculator-only measure (the saver)
          // is asked with it, as choosing it asks
          const own = withCalculatorOnly(used, example.calculatorOnly ?? []);
          const key = exampleKey(example.inputs, { year: y, policies: own, publicationKey });
          const net = peekHouseholdImpact(key, expectedEngine)?.net ?? readStoredHeadline(key, expectedEngine)?.net ?? null;
          if (net) put(example.id, y, net);
          else {
            pending.add(`${example.id}:${y}`);
            asks.push({ example, year: y, key, own });
          }
        }
      }
      return asks;
    };
    let asks = plan();
    publish();
    if (asks.length === 0) return () => controller.abort();

    // One cell: its headline, checked, cached and stored. A refusal of
    // measures the API does not know is thrown for the caller; any other
    // failure leaves the cell to "Calculated when chosen"
    const ask = async ({ example, year: y, key, own }) => {
      const cell = `${example.id}:${y}`;
      try {
        const body = buildHouseholdRequest(example.inputs, { year: y, policies: own, include: HEADLINE_INCLUDE });
        const raw = await post(body, { signal });
        if (signal.aborted) return;
        const data = normaliseHouseholdImpact(raw);
        if (expectedEngine && engineDifferences(expectedEngine, data.engine).length) throw new Error("engine");
        put(example.id, y, data.net);
        rememberHouseholdHeadline(key, data);
        storeHeadline(key, { net: data.net, engine: data.engine ?? null });
      } catch (error) {
        if (signal.aborted) return;
        const unknown = unknownMeasures(error);
        if (unknown) throw new UnknownMeasuresError(unknown);
        failed.add(cell);
      }
      pending.delete(cell);
      publish();
    };
    (async () => {
      // Once, before any request: drop the fill if the publication moved on
      if (confirmPublication && !(await confirmPublication(publicationKey).catch(() => false))) return;
      // The first cell alone: if the API does not know some selected
      // measures, ask again without them (at most twice), then the rest
      let probed = false;
      for (let attempt = 0; attempt < 3 && !probed && !signal.aborted; attempt += 1) {
        try {
          await ask(asks[0]);
          probed = true;
        } catch (error) {
          if (!(error instanceof UnknownMeasuresError)) return;
          used = used.filter((id) => !error.unknown.includes(id));
          storeList(supportedKey, used);
          if (used.length === 0) {
            for (const { example, year: y } of asks) failed.add(`${example.id}:${y}`);
            pending.clear();
            publish();
            return;
          }
          asks = plan();
          publish();
          if (asks.length === 0) return;
        }
      }
      if (!probed || signal.aborted) return;
      await runLimited(
        asks.slice(1).map((item) => () =>
          ask(item).catch(() => {
            // Measures refused after the first cell: leave this one
            failed.add(`${item.example.id}:${item.year}`);
            pending.delete(`${item.example.id}:${item.year}`);
            publish();
          }),
        ),
        EXAMPLE_FILL_CONCURRENCY,
        signal,
      );
    })();
    return () => controller.abort();
    // runKey stands for the selection, publication and engine; examples are fixed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, runKey]);

  if (!active || state.key !== runKey) return { figures: {}, pending: new Set(), failed: new Set(), reduced: null };
  return state;
}
