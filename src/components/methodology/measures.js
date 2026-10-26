/**
 * Public explanations and supported years come from the approved catalogue.
 * `from` is the first year with results, which can come before the policy
 * starts: results cover every year scored.
 */

/**
 * The one modelling note written by hand (#113's scope note): independent
 * text, not part of the receipt, shown with the measure's published
 * description while it is displayed. It names no outside organisation and
 * compares with no outside estimate; its one figure is HMRC's, for the
 * existing relief the cost includes. It holds no figure of ours, which would
 * need a receipt (review of 3d52cff, finding 3); what the data and the model
 * leave out of the measure is in its registry description, which G3
 * approves. A note for a second measure would make this a measure list of
 * the page's own (test_the_page_keeps_no_measure_list_of_its_own); it
 * belongs in the registry and its receipts instead.
 */
export const MODELLING_NOTE = {
  id: "employer_ni_relief_under_25s",
  note: "The cost is gross: it leaves out the change in employers' corporation tax. Estimates of reliefs like this one differ with their scope: the ages covered, whether apprentices are included and whether earnings above the upper earnings limit are relieved. HMRC puts the existing relief for apprentices under 25, which this cost includes for those aged 21 to 24, at about £0.57bn in 2025-26.",
};

/** A text's sentences: a full stop followed by a space and a capital. */
export function sentences(text) {
  return (text ?? "").split(/(?<=\.)\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
}

// A leading sentence this short is a status label ("Candidate measure."),
// not a summary of what the measure does.
const LABEL_WORDS = 4;
const isLabel = (sentence) => sentence.split(/\s+/).length <= LABEL_WORDS;

/** The one-line summary: the first sentence that says what the measure does. */
export function measureSummary(text) {
  const [first = "", second] = sentences(text);
  return second && isLabel(first) ? second : first;
}

/**
 * Modelling facts read from a measure's published text, by wording alone:
 * no rule names a measure, so a new measure's description gets the same
 * chips from the same words. A fact is a plain chip; a limitation is a
 * chip that opens to the sentence it comes from, so a stated data limit or
 * bias stays in view and is never behind "Show more".
 */
export const MODELLING_FACTS = [
  { pattern: /\bday-weighted\b/i, label: "Day-weighted" },
  { pattern: /\bwages are held fixed\b/i, label: "Wages held fixed" },
  { pattern: /\bspending on [a-z ]+ is held fixed\b/i, label: "Spending held fixed" },
  { pattern: /\bfully passed through\b/i, label: "Full pass-through" },
  { pattern: /\bin Great Britain\b/, label: "Great Britain only" },
  { pattern: /\breplacing those reported in the survey\b/i, label: "Modelled, not survey values" },
  { pattern: /\bimputed\b/i, label: "Imputed data" },
];

export const MODELLING_LIMITS = [
  {
    pattern: /\b(?:households|people) in (Scotland|Wales|Northern Ireland) are approximate\b/i,
    label: (match) => `Approximate for ${match[1]}`,
  },
  { pattern: /\bdata identif(?:y|ies) no ([a-z-]+)/i, label: (match) => `Data limit: no ${match[1]} flagged` },
  {
    pattern: /\btoo (?:high|low)\b|\b(?:overstat|understat|under-record|over-record)/i,
    label: () => "Known limitation",
  },
];

/** The fact chips and limitation chips a measure's published text supports. */
export function modellingFacts(text) {
  const facts = MODELLING_FACTS.filter(({ pattern }) => pattern.test(text ?? "")).map(({ label }) => label);
  const limits = [];
  for (const sentence of sentences(text)) {
    for (const { pattern, label } of MODELLING_LIMITS) {
      const match = sentence.match(pattern);
      if (match) {
        limits.push({ label: label(match), sentence });
        break;
      }
    }
  }
  return { facts, limits };
}

// A sentence this short says no more than the fact chip read from it.
const CHIP_WORDS = 12;

/**
 * The published sentences an opened row adds, each said once: not the
 * leading label, the summary line, a limitation chip's sentence, or a short
 * sentence a fact chip already states.
 */
export function remainingPoints(text, summary, limits) {
  const shown = new Set([summary, ...limits.map((limit) => limit.sentence)]);
  return sentences(text).filter((sentence, index) => {
    if (shown.has(sentence)) return false;
    if (index === 0 && isLabel(sentence)) return false;
    const chipped = MODELLING_FACTS.some(({ pattern }) => pattern.test(sentence));
    return !(chipped && sentence.split(/\s+/).length <= CHIP_WORDS);
  });
}

export function measureModelling(catalogue) {
  return catalogue.displayable.map((measure) => {
    const note = measure.id === MODELLING_NOTE.id ? MODELLING_NOTE.note : null;
    const summary = measureSummary(measure.description);
    const found = modellingFacts([measure.description, note].filter(Boolean).join(" "));
    return {
      ...measure,
      how: measure.description,
      note,
      summary,
      points: remainingPoints(measure.description, summary, found.limits),
      notePoints: remainingPoints(note, null, found.limits),
      ...found,
      from: measure.years.filter((year) => !measure.unsupported_years.includes(year)).sort((a, b) => a - b)[0] ?? null,
    };
  });
}

/**
 * The first year with results that most measures share: a measure whose
 * first year differs says so, and the rest say nothing, since a label that
 * is the same on every measure tells the reader nothing.
 */
export function usualFirstYear(measures) {
  const counts = new Map();
  for (const { from } of measures) counts.set(from, (counts.get(from) ?? 0) + 1);
  let usual = null;
  let most = 0;
  for (const [from, count] of counts) {
    if (count > most) [usual, most] = [from, count];
  }
  return usual;
}

/** Catalogue measures whose results are held, unpublished or unverified. */
export function unavailableMeasures(catalogue) {
  return catalogue.measures.filter((measure) => !measure.displayable).map((measure) => ({
    ...measure,
    why: measure.availability.reason || "Verified results are unavailable.",
  }));
}

/**
 * Measures the household model cannot cost, for the Methodology view's
 * "Not modelled" list. Independent text with no figures: none of them is a
 * measure in the registry (src/uk_budget_data/reforms.py); one that becomes
 * modelled leaves here.
 */
export const NOT_MODELLED = [
  {
    name: "Business rates relief for pubs and live music venues",
    why: "Business rates are in the model only as an aggregate with no split by sector.",
  },
  {
    name: "“Your First Home” equity loans",
    why: "The model has no mortgages or equity loans, and the scheme is largely a financial transaction.",
  },
  {
    name: "Online marketplaces collecting VAT",
    why: "It is a compliance measure on sellers' unpaid VAT, which the survey does not record.",
  },
  {
    name: "Bank surcharge rise",
    why: "Corporation tax on banks is not in the household model.",
  },
];
