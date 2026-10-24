import { personalSeriesProblems } from "./publication/manifest";

const IMPACT_KEY = /^impact_[A-Za-z0-9][A-Za-z0-9_]*$/;
const sorted = (values) => [...values].sort();
const sameList = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

/** A column name alone is never evidence of calculation compatibility. */
export function hasPersonalContract(measure, model) {
  const personal = measure?.personal;
  return measure?.displayable === true && measure.availability?.available !== false && personal != null &&
    personalSeriesProblems(personal).length === 0 &&
    personal.model === model && personal.reviewed === true &&
    IMPACT_KEY.test(personal.key) &&
    typeof personal.description === "string" && personal.description.trim().length > 0 &&
    Array.isArray(personal.years) && personal.years.length > 0 &&
    Array.isArray(measure.years) && measure.years.length > 0;
}

/** Every displayed year needs both the publication and model-specific contract. */
export function supportsPersonalYears(measure, years, model) {
  return hasPersonalContract(measure, model) && years.length > 0 && years.every((year) =>
    Number.isInteger(year) && measure.years.includes(year) &&
    !measure.unsupported_years?.includes(year) &&
    measure.personal.years.includes(year) &&
    !measure.personal.unsupported_years?.includes(year),
  );
}

function sameContract(left, right) {
  return left.key === right.key && left.model === right.model &&
    left.reviewed === right.reviewed && left.description === right.description &&
    sameList(left.years ?? [], right.years ?? []) &&
    sameList(left.unsupported_years ?? [], right.unsupported_years ?? []);
}

/**
 * Select only explicitly reviewed impact series, with consistent ownership.
 * Sharing a series requires every owner to declare the same complete group.
 */
export function selectPersonalMeasures(selectedIds, measures, years, model, hasValues) {
  const selected = new Set(selectedIds);
  const byId = new Map(measures.map((measure) => [measure.id, measure]));
  const order = new Map(measures.map((measure, index) => [measure.id, measure.order ?? index]));
  const modelled = new Map();
  const unmodelled = [];
  let partialCombined = false;
  const orderedIds = [...selected].sort((a, b) =>
    (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b),
  );

  for (const id of orderedIds) {
    const measure = byId.get(id);
    const personal = measure?.personal;
    const group = personal?.policies ?? [id];
    const owners = measures.filter((candidate) => candidate.personal?.key === personal?.key && personal?.key)
      .map((candidate) => candidate.id);
    const declared = Array.isArray(group) && group.length > 0 && new Set(group).size === group.length &&
      group.includes(id) && sameList(owners, group);
    const completeGroup = declared && group.every((member) => selected.has(member));
    if (Array.isArray(group) && group.length > 1 && !completeGroup) partialCombined = true;
    const compatibleGroup = completeGroup && group.every((member) => {
      const candidate = byId.get(member);
      const referring = measures.filter((owner) => owner.personal?.policies?.includes(member));
      return supportsPersonalYears(candidate, years, model) &&
        referring.every((owner) => owner.personal.key === personal.key && sameList(owner.personal.policies, group)) &&
        sameList(candidate.personal.policies ?? [member], group) &&
        sameContract(candidate.personal, personal) && hasValues(candidate);
    });
    if (!compatibleGroup) {
      unmodelled.push(measure?.label ?? measure?.name ?? id);
      continue;
    }
    if (!modelled.has(personal.key)) {
      modelled.set(personal.key, {
        ...measure,
        key: personal.key,
        label: group.map((member) => byId.get(member).label ?? byId.get(member).name ?? member).join(", "),
        description: personal.description,
      });
    }
  }
  return { modelled: [...modelled.values()], partialCombined, unmodelled };
}

export function personalSelection(selectedIds, measures = [], results) {
  const years = Object.keys(results?.years ?? {}).map(Number).sort((a, b) => a - b);
  const selection = selectPersonalMeasures(selectedIds, measures, years, "personal", (measure) =>
    years.every((year) => Number.isFinite(results?.policies?.[measure.personal.key]?.years?.[year]?.net_income_change)),
  );
  return { ...selection, years };
}
