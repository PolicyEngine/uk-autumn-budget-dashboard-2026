/**
 * How each measure is modelled, read from the published catalogue for the
 * Policies cards' "How it is modelled": chips for the modelling facts and
 * stated limitations in a measure's published description, and the one
 * hand-written modelling note. Nothing here names a measure except the
 * note's id (test_the_page_keeps_no_measure_list_of_its_own).
 */

/**
 * The one modelling note written by hand (#113's scope note): independent
 * text, not part of the receipt, shown in the measure's "How it is
 * modelled" on the Policies tab while it is displayed. It names no outside organisation and
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

/**
 * Modelling facts read from a measure's published text, by wording alone:
 * no rule names a measure, so a new measure's description gets the same
 * chips from the same words. A fact is a plain chip; a limitation is a
 * chip that opens to the sentence it comes from.
 */
// Shared with legendMembership.js, which read the
// same words
export const WAGES_HELD_FIXED = /\bwages are held fixed\b/i;
export const MODELLED_NOT_SURVEY = /\breplacing those reported in the survey\b/i;

export const MODELLING_FACTS = [
  { pattern: /\bday-weighted\b/i, label: "Day-weighted" },
  { pattern: WAGES_HELD_FIXED, label: "Wages held fixed" },
  { pattern: /\bspending on [a-z ]+ is held fixed\b/i, label: "Spending held fixed" },
  { pattern: /\bfully passed through\b/i, label: "Full pass-through" },
  // Not where the same text takes the measure across the UK later (zero
  // VAT on electricity: Great Britain from October 2026, the UK from April
  // 2027), which "Great Britain only" would contradict
  { pattern: /\bin Great Britain\b/, unless: /\bacross the UK\b|\bNorthern Ireland\b/, label: "Great Britain only" },
  { pattern: MODELLED_NOT_SURVEY, label: "Modelled, not survey values" },
  { pattern: /\bimputed\b/i, label: "Imputed data" },
];

// Each limitation also says when a card's own text already states it, so
// the chip need not open to the sentence again.
const mentions = (text, ...words) => words.every((word) => new RegExp(`\\b${word}`, "i").test(text));

export const MODELLING_LIMITS = [
  {
    pattern: /\b(?:households|people) in (Scotland|Wales|Northern Ireland) are approximate\b/i,
    label: (match) => `Approximate for ${match[1]}`,
    saidIn: (text, match) => mentions(text, match[1], "approximate"),
  },
  {
    pattern: /\bdata identif(?:y|ies) no ([a-z-]+)/i,
    label: (match) => `Data limit: no ${match[1]} flagged`,
    saidIn: (text, match) => mentions(text, "identif", match[1]),
  },
  {
    pattern: /\btoo (?:high|low)\b|\b(?:overstat|understat|under-record|over-record)/i,
    label: () => "Known limitation",
    saidIn: (text, match, sentence) => text.includes(sentence),
  },
];

/**
 * The fact chips and limitation chips a measure's published text supports.
 * With `shown`, the text a card already shows: a fact it states gets no
 * chip, and a limitation it states is marked `said`, so its chip does not
 * open to the sentence again (each fact once).
 */
export function modellingFacts(text, shown = "") {
  const facts = MODELLING_FACTS.filter(
    ({ pattern, unless }) => pattern.test(text ?? "") && !unless?.test(text ?? "") && !pattern.test(shown),
  ).map(({ label }) => label);
  const limits = [];
  for (const sentence of sentences(text)) {
    for (const { pattern, label, saidIn } of MODELLING_LIMITS) {
      const match = sentence.match(pattern);
      if (match) {
        limits.push({ label: label(match), sentence, said: Boolean(shown) && saidIn(shown, match, sentence) });
        break;
      }
    }
  }
  return { facts, limits };
}

/**
 * A measure's modelling, from its published description and any modelling
 * note: fact chips, limitation chips (each with its sentence) and the
 * note's sentences, less what `shown` (the card's own text) already says.
 */
export function measureModellingFacts(measure, shown = "") {
  const note = measure?.id === MODELLING_NOTE.id ? MODELLING_NOTE.note : null;
  return {
    ...modellingFacts([measure?.description, note].filter(Boolean).join(" "), shown),
    notePoints: sentences(note),
  };
}
