/**
 * A measure's category (its tax or benefit type) and the icon that stands
 * for it on every per-measure row, derived from the publication alone so a
 * measure the page has never seen (a Budget-day measure, say) still gets
 * one: never a list of measure ids.
 *
 * Order of evidence: the manifest's (or receipt's) own `category` field,
 * when the publication carries one; else the first category whose words
 * appear in the measure's published name, then in its id, then the one
 * named first in its description. In a name or id the categories are tried
 * in the order below, so the more specific wins ("VAT cut on road fuel" is VAT, "State
 * Pension income tax protection" is income tax), after the named schemes
 * whose names hold another category's words (NAMED_SCHEMES). A measure
 * that matches none is "Other", with a plain tag icon.
 */

// Each category: its caption, its icon (TitleIcon), and its words. Texts
// are lower-cased with "_" and "-" read as spaces before matching.
export const MEASURE_CATEGORIES = [
  { label: "VAT", icon: "receipt", pattern: /\bvat\b|value added tax/ },
  { label: "Fuel duty", icon: "fuel", pattern: /fuel duty|\bfuel\b|petrol|diesel/ },
  { label: "Capital gains tax", icon: "trend", pattern: /capital gains|\bcgt\b|\bbadr\b|business asset disposal|investors'? relief/ },
  { label: "National Insurance", icon: "briefcase", pattern: /national insurance|\bnics?\b|\bni\b|salary sacrifice/ },
  { label: "Student loans", icon: "cap", pattern: /student|\bplan [12345]\b|postgraduate loan|tuition/ },
  { label: "Childcare", icon: "users", pattern: /childcare|child care|nursery|free hours/ },
  { label: "Energy", icon: "flame", pattern: /warm home|energy|electricity|\bgas\b|heating|\bheat\b|ofgem|\bwhd\b/ },
  { label: "Income tax", icon: "wallet", pattern: /income tax|personal allowance|basic rate|higher rate|additional rate|dividend|savings allowance|marriage allowance/ },
  { label: "Pensions", icon: "armchair", pattern: /pension|triple lock|annuit/ },
  { label: "Benefits", icon: "piggy", pattern: /universal credit|\buc\b|benefit|tax credit|\bpip\b|disability|carer|jobseeker|\besa\b|two child|child limit|winter fuel/ },
  { label: "Council tax", icon: "landmark", pattern: /council tax/ },
  { label: "Property", icon: "house", pattern: /stamp duty|\bsdlt\b|property|mansion|housing|\brent\b|mortgage|inheritance|\bland\b|second home/ },
  { label: "Business", icon: "building", pattern: /business|corporation tax|employer|company|companies|\blevy\b|levies|apprenticeship|\bbank\b|windfall|digital services|duty|duties|tariff/ },
];

export const OTHER_CATEGORY = { label: "Other", icon: "tag" };

// Schemes whose names hold another category's words, placed by the scheme
// before the categories' words are tried (and, in a description, when the
// scheme is named first): the Winter Fuel Payment is a
// benefit, not fuel duty or pensions; Stamp Duty Land Tax's "Higher Rate
// of Additional Dwelling" is property, not income tax; the Local Housing
// Allowance is a benefit, not property; a freeze of "personal income tax
// and equivalent national insurance thresholds" is income tax, as this
// Budget's threshold freeze is. (Names of past events' measures, #107.)
const NAMED_SCHEMES = [
  { label: "Benefits", pattern: /winter fuel|local housing allowance|\blha\b/ },
  { label: "Property", pattern: /stamp duty|\bsdlt\b/ },
  { label: "Income tax", pattern: /personal income tax/ },
];

const normalise = (text) => String(text ?? "").toLowerCase().replace(/[_-]+/g, " ");

// A named scheme's words, standing for its category's entry
const SCHEME_WORDS = NAMED_SCHEMES.map(({ label, pattern }) => ({ pattern, category: MEASURE_CATEGORIES.find((category) => category.label === label) }));

/**
 * The category entry for one text, or null: in a name or id, a named
 * scheme's, then the first in MEASURE_CATEGORIES' order whose words appear;
 * in a description (`earliest`), the one whose words come first in it, since
 * a description names its own tax before the others it touches ("The income
 * tax personal allowance … the National Insurance primary threshold …" is
 * income tax). A scheme named at the same place as a category's word wins.
 */
function categoryInText(text, earliest = false) {
  const words = normalise(text);
  if (!words.trim()) return null;
  if (!earliest) {
    const scheme = SCHEME_WORDS.find(({ pattern }) => pattern.test(words));
    if (scheme) return scheme.category;
    return MEASURE_CATEGORIES.find(({ pattern }) => pattern.test(words)) ?? null;
  }
  let best = null;
  let bestAt = Infinity;
  for (const { pattern, category } of [...SCHEME_WORDS, ...MEASURE_CATEGORIES.map((entry) => ({ pattern: entry.pattern, category: entry }))]) {
    const at = words.search(pattern);
    if (at >= 0 && at < bestAt) { best = category; bestAt = at; }
  }
  return best;
}

/** The category entry for a category caption (a manifest's own, say). */
function categoryFromLabel(label) {
  const words = normalise(label).trim();
  if (!words) return null;
  const known = MEASURE_CATEGORIES.find((category) => normalise(category.label) === words) ?? categoryInText(label);
  // A published caption is shown as published, with the icon its words call for
  return { label: String(label).trim(), icon: (known ?? OTHER_CATEGORY).icon };
}

/**
 * A measure's category, as `{ label, icon }`, for any catalogue measure
 * (or a bare `{ id, name, description }`): never null, never throws.
 */
export function measureCategoryOf(measure) {
  if (!measure) return OTHER_CATEGORY;
  const published = typeof measure.category === "string" ? categoryFromLabel(measure.category) : null;
  if (published) return published;
  for (const text of [measure.name, measure.label, measure.id]) {
    const found = categoryInText(text);
    if (found) return { label: found.label, icon: found.icon };
  }
  const found = categoryInText(measure.description, true);
  if (found) return { label: found.label, icon: found.icon };
  return OTHER_CATEGORY;
}

/** The icon for a category caption, by its words; "tag" when none match. */
export function categoryIcon(category) {
  if (!category) return OTHER_CATEGORY.icon;
  return categoryFromLabel(category)?.icon ?? OTHER_CATEGORY.icon;
}
