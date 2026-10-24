/**
 * The real public/data/living_standards_outlook.json against the shape in
 * docs/DATA_CONTRACT.md, which the Living standards view reads. The file is
 * written by `uk-budget-data living-standards` (and its forecast block by
 * `uk-budget-data obr-forecast`). The view's loader checks only the HTTP
 * status, so a file of another shape would otherwise reach the page
 * unnoticed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/data/living_standards_outlook.json",
);

const FY = /^\d{4}-\d{2}$/;
const SECTIONS = [
  "meta",
  "living_standards",
  "poverty",
  "forecast",
  "income_by_decile",
  "child_poverty_by_family",
  "inequality",
  "deep_poverty",
  "poverty_by_group",
];

// Collects every problem with a path, so one run lists them all.
let problems;
const fail = (path, message) => problems.push(`${path}: ${message}`);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

function object(v, path) {
  if (!isObject(v)) fail(path, "is not an object");
  return isObject(v) ? v : {};
}
function array(v, path, { nonEmpty = true } = {}) {
  if (!Array.isArray(v)) fail(path, "is not an array");
  else if (nonEmpty && v.length === 0) fail(path, "is empty");
  return Array.isArray(v) ? v : [];
}
function string(v, path) {
  if (typeof v !== "string" || !v.trim()) fail(path, "is not a non-empty string");
}
function number(v, path, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (nullable && v === null) return;
  if (!isNumber(v)) fail(path, `is not a finite number (${JSON.stringify(v)})`);
  else if (v < min || v > max) fail(path, `${v} is outside [${min}, ${max}]`);
}
function fiscalYear(v, path) {
  if (typeof v !== "string" || !FY.test(v)) fail(path, `${JSON.stringify(v)} is not a fiscal year`);
}
function labels(v, path) {
  const o = object(v, path);
  if (!Object.keys(o).length) fail(path, "has no entries");
  for (const [k, label] of Object.entries(o)) string(label, `${path}.${k}`);
  return Object.keys(o);
}
function sentences(v, path, { nonEmpty = false } = {}) {
  for (const [i, s] of array(v, path, { nonEmpty }).entries()) string(s, `${path}[${i}]`);
}

/** A series of {year, <key>} points in rising fiscal years. */
function series(v, path, check, { endYear } = {}) {
  const points = array(v, path);
  points.forEach((p, i) => {
    const where = `${path}[${i}]`;
    object(p, where);
    fiscalYear(p?.year, `${where}.year`);
    check(p ?? {}, where);
  });
  const years = points.map((p) => p?.year);
  if (years.some((y, i) => i > 0 && !(y > years[i - 1]))) fail(path, "years do not rise");
  if (endYear && years.some((y) => typeof y === "string" && y > endYear)) {
    fail(path, `runs past ${endYear}`);
  }
}

const rate = (p, where) => number(p.rate, `${where}.rate`, { min: 0, max: 1 });

describe("living_standards_outlook.json matches DATA_CONTRACT.md", () => {
  let data;
  let end;
  beforeAll(() => {
    data = JSON.parse(readFileSync(FILE, "utf8"));
    end = data?.meta?.headline_end_year;
  });

  const run = (check) => () => {
    problems = [];
    check();
    expect(problems).toEqual([]);
  };

  it("has every section the view reads", () => {
    expect(isObject(data)).toBe(true);
    expect(SECTIONS.filter((key) => !isObject(data[key]))).toEqual([]);
  });

  it(
    "meta",
    run(() => {
      const meta = object(data.meta, "meta");
      if (Number.isNaN(Date.parse(meta.generated_at))) fail("meta.generated_at", "is not a timestamp");
      for (const key of [
        "policyengine",
        "policyengine_uk",
        "deflator",
        "outturn_source",
        "headline_end_year_note",
        "cpi_ahc_note",
      ]) {
        string(meta[key], `meta.${key}`);
      }
      const dataset = object(meta.dataset, "meta.dataset");
      string(dataset.name, "meta.dataset.name");
      string(dataset.sha256, "meta.dataset.sha256");
      for (const key of ["real_price_base", "headline_start_year", "headline_end_year"]) {
        fiscalYear(meta[key], `meta.${key}`);
      }
      if (!(meta.headline_start_year < meta.headline_end_year)) {
        fail("meta.headline_start_year", "is not before headline_end_year");
      }
      // The view labels the BHC and AHC income series from these units.
      const units = object(meta.units, "meta.units");
      string(units.median_equivalised_income, "meta.units.median_equivalised_income");
      string(units.mean_equivalised_income_ahc, "meta.units.mean_equivalised_income_ahc");
      object(meta.method, "meta.method");
      object(meta.comparators, "meta.comparators");
      sentences(meta.notes, "meta.notes");
      sentences(meta.caveats, "meta.caveats", { nonEmpty: true });
    }),
  );

  it(
    "living_standards",
    run(() => {
      const ls = object(data.living_standards, "living_standards");
      const metrics = labels(ls.metrics, "living_standards.metrics");
      for (const part of ["outturn", "projection"]) {
        const byMetric = object(ls[part], `living_standards.${part}`);
        for (const [metric, points] of Object.entries(byMetric)) {
          const path = `living_standards.${part}.${metric}`;
          if (!metrics.includes(metric)) fail(path, "is not in metrics");
          series(
            points,
            path,
            (p, where) => {
              number(p.real, `${where}.real`, { min: 0 });
              number(p.nominal, `${where}.nominal`, { min: 0, nullable: true });
            },
            { endYear: part === "projection" ? end : undefined },
          );
        }
      }
      if (!ls.projection?.median_equivalised_income) {
        fail("living_standards.projection.median_equivalised_income", "is missing");
      }
    }),
  );

  it(
    "poverty",
    run(() => {
      const poverty = object(data.poverty, "poverty");
      const measures = labels(poverty.measures, "poverty.measures");
      const groups = labels(poverty.groups, "poverty.groups");
      for (const part of ["outturn", "projection"]) {
        for (const [measure, byGroup] of Object.entries(object(poverty[part], `poverty.${part}`))) {
          if (!measures.includes(measure)) fail(`poverty.${part}.${measure}`, "is not a measure");
          for (const [group, points] of Object.entries(object(byGroup, `poverty.${part}.${measure}`))) {
            const path = `poverty.${part}.${measure}.${group}`;
            if (!groups.includes(group)) fail(path, "is not a group");
            series(points, path, rate, { endYear: part === "projection" ? end : undefined });
          }
        }
      }
      if (!poverty.projection?.relative_ahc?.all) fail("poverty.projection.relative_ahc.all", "is missing");
      sentences(poverty.notes, "poverty.notes");
    }),
  );

  it(
    "forecast",
    run(() => {
      const fc = object(data.forecast, "forecast");
      string(fc.pre_label, "forecast.pre_label");
      string(fc.post_label, "forecast.post_label");
      if (typeof fc.post_published !== "boolean") fail("forecast.post_published", "is not a boolean");
      // Optional: the OBR file(s) the series come from. post_source is null
      // until the Budget forecast is published, and then names its file.
      const sourceBlock = (v, path) => {
        const o = object(v, path);
        string(o.release, `${path}.release`);
        if (o.url != null) string(o.url, `${path}.url`);
        if (o.file_sha256 != null && !/^[0-9a-f]{64}$/.test(o.file_sha256)) fail(`${path}.file_sha256`, "is not a SHA-256");
      };
      if (fc.pre_source != null) sourceBlock(fc.pre_source, "forecast.pre_source");
      if (fc.post_published && fc.post_source !== undefined) sourceBlock(fc.post_source, "forecast.post_source");
      if (fc.post_published === false && fc.post_source != null) fail("forecast.post_source", "is set while post_published is false");
      const keys = [];
      for (const [i, section] of array(fc.sections, "forecast.sections").entries()) {
        const sp = `forecast.sections[${i}]`;
        string(section?.title, `${sp}.title`);
        for (const [j, s] of array(section?.series, `${sp}.series`).entries()) {
          const path = `${sp}.series[${j}]`;
          string(s?.key, `${path}.key`);
          string(s?.label, `${path}.label`);
          keys.push(s?.key);
          for (const side of ["pre", "post"]) {
            const points = array(s?.[side], `${path}.${side}`);
            points.forEach((p, k) => {
              if (!/^\d{4}(-\d{2})?$/.test(String(p?.year))) fail(`${path}.${side}[${k}].year`, "is not a year");
              number(p?.value, `${path}.${side}[${k}].value`);
            });
          }
          if (s?.post_source != null) string(s.post_source, `${path}.post_source`);
          // Until the Budget forecast is out, post equals pre (the view says so).
          if (fc.post_published === false && JSON.stringify(s?.pre) !== JSON.stringify(s?.post)) {
            fail(path, "post differs from pre while post_published is false");
          }
        }
      }
      for (const key of array(fc.headline, "forecast.headline")) {
        if (!keys.includes(key)) fail("forecast.headline", `${key} is not a series`);
      }
    }),
  );

  it(
    "income_by_decile",
    run(() => {
      const ibd = object(data.income_by_decile, "income_by_decile");
      fiscalYear(ibd.base_year, "income_by_decile.base_year");
      fiscalYear(ibd.end_year, "income_by_decile.end_year");
      if (ibd.end_year !== end) fail("income_by_decile.end_year", `is not ${end}`);
      expect(ibd.deciles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const ten = (v, path) => {
        const values = array(v, path);
        if (values.length !== 10) fail(path, `has ${values.length} values, not 10`);
        values.forEach((x, i) => number(x, `${path}[${i}]`));
      };
      for (const basis of ["bhc", "ahc"]) {
        const b = object(ibd[basis], `income_by_decile.${basis}`);
        ten(b.cumulative_growth_to_end, `income_by_decile.${basis}.cumulative_growth_to_end`);
        series(
          b.by_year,
          `income_by_decile.${basis}.by_year`,
          (p, where) => {
            ten(p.real_median, `${where}.real_median`);
            ten(p.cumulative_growth, `${where}.cumulative_growth`);
          },
          { endYear: end },
        );
      }
      const split = object(ibd.non_pensioner_split, "income_by_decile.non_pensioner_split");
      for (const group of ["below_middle", "above_middle"]) {
        series(
          split.series?.[group],
          `income_by_decile.non_pensioner_split.series.${group}`,
          (p, where) => {
            number(p.real_mean, `${where}.real_mean`, { min: 0 });
            number(p.cumulative_growth, `${where}.cumulative_growth`);
          },
          { endYear: end },
        );
      }
      sentences(ibd.notes, "income_by_decile.notes");
    }),
  );

  it(
    "child_poverty_by_family",
    run(() => {
      const cp = object(data.child_poverty_by_family, "child_poverty_by_family");
      const measures = labels(cp.measures, "child_poverty_by_family.measures");
      const groups = labels(cp.groups, "child_poverty_by_family.groups");
      for (const [measure, byGroup] of Object.entries(object(cp.projection, "child_poverty_by_family.projection"))) {
        if (!measures.includes(measure)) fail(`child_poverty_by_family.projection.${measure}`, "is not a measure");
        for (const [group, points] of Object.entries(object(byGroup, measure))) {
          const path = `child_poverty_by_family.projection.${measure}.${group}`;
          if (!groups.includes(group)) fail(path, "is not a group");
          series(points, path, rate, { endYear: end });
        }
      }
      sentences(cp.notes, "child_poverty_by_family.notes");
    }),
  );

  it(
    "inequality",
    run(() => {
      const ineq = object(data.inequality, "inequality");
      const measures = labels(ineq.measures, "inequality.measures");
      expect(measures).toEqual(expect.arrayContaining(["gini", "p90_p10"]));
      labels(ineq.bases, "inequality.bases");
      for (const part of ["outturn", "projection"]) {
        for (const measure of ["gini", "p90_p10"]) {
          for (const basis of ["bhc", "ahc"]) {
            const path = `inequality.${part}.${measure}.${basis}`;
            series(
              ineq[part]?.[measure]?.[basis],
              path,
              (p, where) =>
                // Gini is a fraction (0.33, not 33); a 90:10 ratio exceeds 1.
                measure === "gini"
                  ? number(p.value, `${where}.value`, { min: 0, max: 1 })
                  : number(p.value, `${where}.value`, { min: 1 }),
              { endYear: part === "projection" ? end : undefined },
            );
          }
        }
      }
      sentences(ineq.notes, "inequality.notes");
    }),
  );

  it(
    "deep_poverty",
    run(() => {
      const dp = object(data.deep_poverty, "deep_poverty");
      const measures = labels(dp.measures, "deep_poverty.measures");
      for (const measure of measures) {
        series(
          dp.projection?.[measure],
          `deep_poverty.projection.${measure}`,
          (p, where) => {
            rate(p, where);
            number(p.people_millions, `${where}.people_millions`, { min: 0 });
            number(p.threshold_annual, `${where}.threshold_annual`, { min: 0 });
          },
          { endYear: end },
        );
      }
      sentences(dp.notes, "deep_poverty.notes");
    }),
  );

  it(
    "poverty_by_group",
    run(() => {
      const pg = object(data.poverty_by_group, "poverty_by_group");
      const years = array(pg.years, "poverty_by_group.years");
      years.forEach((y, i) => fiscalYear(y, `poverty_by_group.years[${i}]`));
      labels(pg.measures, "poverty_by_group.measures");
      number(pg.min_unweighted_households, "poverty_by_group.min_unweighted_households", { min: 1 });
      const breakdowns = object(pg.breakdowns, "poverty_by_group.breakdowns");
      for (const name of ["tenure", "family_type"]) {
        if (!isObject(breakdowns[name])) fail(`poverty_by_group.breakdowns.${name}`, "is missing");
      }
      for (const [name, b] of Object.entries(breakdowns)) {
        const bp = `poverty_by_group.breakdowns.${name}`;
        string(b?.label, `${bp}.label`);
        const groups = labels(b?.groups, `${bp}.groups`);
        const cells = object(b?.cells, `${bp}.cells`);
        for (const group of groups) {
          for (const year of years) {
            const path = `${bp}.cells.${group}.${year}`;
            const cell = cells[group]?.[year];
            if (!isObject(cell)) {
              fail(path, "is missing");
              continue;
            }
            if (typeof cell.suppressed !== "boolean") fail(`${path}.suppressed`, "is not a boolean");
            number(cell.unweighted_households, `${path}.unweighted_households`, { min: 0 });
            const small = cell.unweighted_households < pg.min_unweighted_households;
            if (small !== cell.suppressed) fail(path, "suppression does not follow min_unweighted_households");
            if (cell.suppressed) {
              if (cell.relative_ahc !== null) fail(`${path}.relative_ahc`, "is shown in a suppressed cell");
            } else {
              number(cell.relative_ahc, `${path}.relative_ahc`, { min: 0, max: 1 });
              number(cell.median_equivalised_income_bhc?.real, `${path}.median_equivalised_income_bhc.real`, {
                min: 0,
              });
              number(cell.people_millions, `${path}.people_millions`, { min: 0 });
            }
          }
        }
      }
      sentences(pg.notes, "poverty_by_group.notes");
    }),
  );

  // Not shown any more: tolerated in the file, checked only when present
  it(
    "obr_rhdi (optional)",
    run(() => {
      if (data.obr_rhdi === undefined) return;
      const rhdi = object(data.obr_rhdi, "obr_rhdi");
      for (const key of ["label", "unit", "source"]) string(rhdi[key], `obr_rhdi.${key}`);
      series(rhdi.series, "obr_rhdi.series", (p, where) => {
        number(p.value, `${where}.value`, { min: 0 });
        number(p.growth, `${where}.growth`, { nullable: true });
        if (p.type !== "outturn" && p.type !== "forecast") fail(`${where}.type`, `is ${JSON.stringify(p.type)}`);
      });
      sentences(rhdi.notes, "obr_rhdi.notes");
    }),
  );
});
