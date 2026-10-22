/**
 * Synthetic results by demographic group for tests: invented figures in
 * the published format, never survey results. The group codes and names
 * are the published ones.
 */

const COLUMNS = [
  "level",
  "area_code",
  "area_name",
  "reform",
  "year",
  "outcome",
  "value",
  "lo",
  "hi",
  "direction",
  "tier",
  "reason",
  "support_band",
  "noise",
  "estimator",
];

export const GROUP_NAMES = Object.freeze({
  child: "Children (under 18)",
  adult: "Working age (18 to 64)",
  senior: "Pensioners (65 and over)",
  AGE_0_17: "0 to 17",
  AGE_18_24: "18 to 24",
  AGE_25_34: "25 to 34",
  AGE_35_49: "35 to 49",
  AGE_50_64: "50 to 64",
  AGE_65_79: "65 to 79",
  AGE_80_PLUS: "80 and over",
  NOT_IN_WORK_OR_EDUCATION: "Not in work or education",
  IN_WORK_OR_EDUCATION: "In work or education",
  EMPLOYEE: "Employees",
  RETIRED: "Retired",
});

export const MEASURE = "two_child_limit";
export const PACKAGE = "autumn_budget_2026_combined";

/** The measures the tests' page offers. */
export const TEST_POLICIES = Object.freeze([
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "fuel_duty_freeze", name: "Fuel duty freeze" },
]);

const reported = (value, lo, hi, direction = "gain") => ({
  value,
  lo,
  hi,
  direction,
  tier: "reported",
  reason: "",
  support_band: "30+",
});

const approximate = (value, lo, hi, direction) => ({
  ...reported(value, lo, hi, direction),
  tier: "approximate",
  reason: "thin_support",
  support_band: "10–29",
});

const WITHHELD = {
  value: "",
  lo: "",
  hi: "",
  direction: "",
  tier: "withheld",
  reason: "disclosure_control",
  support_band: "",
};

// [level, code, reform, year, average_change, relative_change]
const GROUPS = [
  ["age_group", "child", MEASURE, 2029, reported("410.0", "350.0", "470.0"), reported("0.0123", "0.01", "0.015")],
  ["age_group", "adult", MEASURE, 2029, reported("75.0", "60.0", "90.0"), reported("0.0021", "0.0015", "0.0027")],
  ["age_group", "senior", MEASURE, 2029, approximate("12.0", "-5.0", "30.0", "too_close_to_call"), approximate("0.0004", "-0.0002", "0.001", "too_close_to_call")],
  ["age_band", "AGE_0_17", MEASURE, 2029, reported("410.0", "350.0", "470.0"), reported("0.0123", "0.01", "0.015")],
  ["age_band", "AGE_18_24", MEASURE, 2029, reported("110.0", "80.0", "140.0"), reported("0.003", "0.002", "0.004")],
  ["age_band", "AGE_25_34", MEASURE, 2029, reported("150.0", "120.0", "180.0"), reported("0.004", "0.003", "0.005")],
  ["age_band", "AGE_35_49", MEASURE, 2029, reported("95.0", "70.0", "120.0"), reported("0.0025", "0.0018", "0.0032")],
  ["age_band", "AGE_50_64", MEASURE, 2029, reported("20.0", "10.0", "30.0"), reported("0.0005", "0.0002", "0.0008")],
  ["age_band", "AGE_65_79", MEASURE, 2029, reported("14.0", "2.0", "26.0"), reported("0.0004", "0.0001", "0.0007")],
  ["age_band", "AGE_80_PLUS", MEASURE, 2029, WITHHELD, WITHHELD],
  ["young_people", "NOT_IN_WORK_OR_EDUCATION", MEASURE, 2029, WITHHELD, WITHHELD],
  ["young_people", "IN_WORK_OR_EDUCATION", MEASURE, 2029, reported("105.0", "75.0", "135.0"), reported("0.0029", "0.0019", "0.0039")],
  ["employment", "EMPLOYEE", MEASURE, 2029, reported("70.0", "55.0", "85.0"), reported("0.002", "0.0014", "0.0026")],
  ["employment", "RETIRED", MEASURE, 2029, reported("10.0", "1.0", "19.0"), reported("0.0003", "0.0001", "0.0005")],
  ["age_group", "child", MEASURE, 2030, reported("520.0", "450.0", "590.0"), reported("0.015", "0.012", "0.018")],
  ["age_group", "adult", MEASURE, 2030, reported("90.0", "70.0", "110.0"), reported("0.0025", "0.0018", "0.0032")],
  ["age_group", "senior", MEASURE, 2030, reported("15.0", "5.0", "25.0"), reported("0.0005", "0.0002", "0.0008")],
  ["age_group", "child", PACKAGE, 2029, reported("-150.0", "-200.0", "-100.0", "loss"), reported("-0.004", "-0.006", "-0.002", "loss")],
  ["age_group", "adult", PACKAGE, 2029, reported("-260.0", "-300.0", "-220.0", "loss"), reported("-0.006", "-0.007", "-0.005", "loss")],
  ["age_group", "senior", PACKAGE, 2029, reported("40.0", "20.0", "60.0"), reported("0.001", "0.0005", "0.0015")],
];

const cell = (text) =>
  /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** demographics.csv's text, for some of the groups above (all by default). */
export function demographicsCsv({ levels } = {}) {
  const rows = GROUPS.filter(([level]) => !levels || levels.includes(level));
  const lines = rows.flatMap(([level, code, reform, year, average, relative]) =>
    [
      ["average_change", average],
      ["relative_change", relative],
    ].map(([outcome, figures]) => {
      const record = {
        level,
        area_code: code,
        area_name: GROUP_NAMES[code],
        reform,
        year: String(year),
        outcome,
        ...figures,
        noise: "False",
        estimator: "direct",
      };
      return COLUMNS.map((column) => cell(record[column])).join(",");
    }),
  );
  return [COLUMNS.join(","), ...lines].join("\n");
}

/** poverty_by_age.csv's text: invented rates, in per cent. */
export const POVERTY_CSV = [
  "reform,year,age_group,baseline_rate,reform_rate,change_pp",
  `${MEASURE},2029,child,18.4,15.9,-2.5`,
  `${MEASURE},2029,adult,13.1,12.9,-0.2`,
  `${MEASURE},2029,senior,12.0,12.0,0.0`,
  `${MEASURE},2030,child,18.9,16.1,-2.8`,
  `${MEASURE},2030,adult,13.3,13.1,-0.2`,
  `${MEASURE},2030,senior,12.2,12.2,0.0`,
  `${PACKAGE},2029,child,18.4,19.6,1.2`,
  `${PACKAGE},2029,adult,13.1,13.5,0.4`,
  `${PACKAGE},2029,senior,12.0,11.9,-0.1`,
].join("\n");
