/**
 * Match published measures to response columns without a frontend measure list.
 * A published personal mapping may share one response column across several
 * measures; that series is usable only when its complete group is selected.
 * Otherwise the API must return a column named by the id, optionally prefixed
 * with "impact_". Missing values are unavailable, never implicit zeros.
 */
export function lifecycleSelection(selectedIds, measures = [], rows = []) {
  const selected = new Set(selectedIds);
  const byId = new Map(measures.map((measure) => [measure.id, measure]));
  const order = new Map(measures.map((measure, index) => [measure.id, measure.order ?? index]));
  const reforms = new Map();
  const unmodelled = [];
  let partialCombined = false;

  const orderedIds = [...selected].sort((a, b) =>
    (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b),
  );
  for (const id of orderedIds) {
    const measure = byId.get(id);
    const label = measure?.label ?? measure?.name ?? id;
    const group = Array.isArray(measure?.personal?.policies)
      ? measure.personal.policies
      : [id];
    const completeGroup = group.length > 0 && group.every((member) =>
      selected.has(member) && byId.has(member) && byId.get(member).displayable !== false,
    );
    if (group.length > 1 && !completeGroup) partialCombined = true;
    const candidates = measure?.personal?.key
      ? [measure.personal.key]
      : [id, `impact_${id}`];
    const key = candidates.find((candidate) =>
      rows.length > 0 && rows.every((row) => Number.isFinite(row[candidate])),
    );
    if (!measure || measure.displayable === false || !completeGroup || !key) {
      unmodelled.push(label);
      continue;
    }
    if (!reforms.has(key)) {
      reforms.set(key, {
        ...measure,
        key,
        label: measure.personal?.label ?? group.map((member) => {
          const published = byId.get(member);
          return published?.label ?? published?.name ?? member;
        }).join(", "),
        description: group.map((member) => byId.get(member)?.description).filter(Boolean).join(" "),
      });
    }
  }

  return { reforms: [...reforms.values()], partialCombined, unmodelled };
}

/** A total is unavailable if any requested response column is missing. */
export function lifecycleTotals(rows, reforms) {
  if (!rows.length || !reforms.length) return { netTotal: null, avgPerYear: null };
  if (rows.some((row) => reforms.some(({ key }) => !Number.isFinite(row[key])))) {
    return { netTotal: null, avgPerYear: null };
  }
  const netTotal = rows.reduce(
    (sum, row) => sum + reforms.reduce((rowSum, { key }) => rowSum + row[key], 0),
    0,
  );
  return { netTotal, avgPerYear: netTotal / rows.length };
}
