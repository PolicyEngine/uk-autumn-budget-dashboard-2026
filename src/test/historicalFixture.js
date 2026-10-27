/**
 * Test helpers for a past event's flat views (utils/historical.js): CSV
 * text as Python's csv module writes it, exact decimals and shares as the
 * scorecard writes them, a coverage table built from a synthetic event, and
 * a fetch stand-in serving the publication fixture as one past event's
 * release. Synthetic test data; never real figures.
 */
import { add, CLASSES, compare, COMPUTED_ROW, COVERAGE_HEADER, fraction, sum, ZERO } from "../utils/historical";
import { sha256Hex } from "../utils/publication/digest";
import { RELEASE_INDEX_SCHEMA } from "../utils/publication/flat";
import { dataRoot } from "../utils/publication/release";
import { fixtureBytes, fixtureJson } from "./publicationFixture";

/** RFC 4180 text, as Python's csv module writes it. */
export function toCsv(header, rows) {
  const cell = (value) => {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

export const shareText = (f) => `${f.num}/${f.den}`;

/**
 * A fraction whose denominator divides a power of ten, as the shortest
 * decimal text, the way Python's Decimal normalize() and "f" format write it.
 */
export function decimalText(f) {
  let places = 0;
  let scale = 1n;
  while ((f.num * scale) % f.den !== 0n) {
    scale *= 10n;
    places += 1;
    if (places > 80) throw new Error("not a decimal");
  }
  const scaled = (f.num * scale) / f.den;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, "0");
  const body = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return negative ? `-${body}` : body;
}

/** The coverage table a synthetic event gives, built independently of the page's checks. */
export function coverageOf(measures) {
  const account = () => ({ measures: 0, rows: 0, net: ZERO, absolute: ZERO });
  const classes = Object.fromEntries(CLASSES.map((name) => [name, account()]));
  const gaps = {};
  const computed = account();
  for (const measure of measures) {
    classes[measure.classification].measures += 1;
    if (measure.classification === "not_expressible") (gaps[measure.gap] ??= account()).measures += 1;
    if (measure.computed) computed.measures += 1;
    for (const row of measure.rows) {
      const into = [classes[row.classification]];
      if (row.classification === "not_expressible") into.push(gaps[row.gap ?? measure.gap] ??= account());
      if (measure.computed && row.constructed) into.push(computed);
      for (const entry of into) {
        entry.rows += 1;
        entry.net = add(entry.net, row.value);
        entry.absolute = add(entry.absolute, row.value.num < 0n ? fraction(-row.value.num, row.value.den) : row.value);
      }
    }
  }
  const totalMeasures = measures.length;
  const totalAbsolute = sum(CLASSES.map((name) => classes[name].absolute));
  const share = (part, total) => (compare(total, ZERO) === 0 ? ZERO : fraction(part.num * total.den, part.den * total.num));
  const line = (name, gap, entry, net = true) => [
    name, gap, entry.measures, entry.rows,
    net ? decimalText(entry.net) : "",
    decimalText(entry.absolute),
    shareText(share(entry.absolute, totalAbsolute)),
    shareText(share(fraction(BigInt(entry.measures)), fraction(BigInt(totalMeasures)))),
  ];
  return toCsv(COVERAGE_HEADER, [
    ...CLASSES.map((name) => line(name, "", classes[name])),
    ...Object.keys(gaps).sort().map((gap) => line("not_expressible", gap, gaps[gap])),
    line(COMPUTED_ROW, "", computed, false),
  ]);
}


/**
 * A fetch stand-in serving the publication fixture as one release's data
 * root, `${basePath}/data/releases/<id>`: its manifest relabelled with
 * `identity` (by default the release's own), and the `flat` view files
 * (name to text) bound to that manifest by a release index. `overrides`
 * replaces a path under the root with other text, or an HTTP status, after
 * the binding, so a changed file no longer matches. A past event binds no
 * area provenance; `provenance` binds a digest in the manifest, the index or
 * both, to test its refusal. Every URL is recorded.
 */
export async function releaseFixtureFetch(release, { basePath = "", flat = {}, identity = { id: release.id, date: release.date }, overrides = {}, provenance = {} } = {}) {
  const manifest = { ...fixtureJson("manifest.json"), release: identity.id, budget: identity };
  manifest.flat_files = Object.fromEntries(await Promise.all(Object.entries(flat).map(async ([name, text]) => [name, await sha256Hex(text)])));
  if (provenance.manifest !== undefined) manifest.flat_provenance_sha256 = provenance.manifest;
  const manifestText = JSON.stringify(manifest);
  const index = {
    schema: RELEASE_INDEX_SCHEMA,
    release: manifest.release,
    budget: manifest.budget,
    manifest_revision: manifest.revision,
    manifest_sha256: await sha256Hex(manifestText),
    files: manifest.flat_files,
    // A past event binds no area table, so no alias (as publish index writes it)
    aliases: {},
    ...(provenance.index !== undefined ? { flat_provenance_sha256: provenance.index } : {}),
  };
  const files = { "manifest.json": manifestText, "release-index.json": JSON.stringify(index), ...flat, ...overrides };
  const prefix = `${dataRoot(basePath, release)}/`;
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (!url.startsWith(prefix)) return new Response(null, { status: 404 });
    const path = url.slice(prefix.length);
    if (Object.hasOwn(files, path)) {
      return typeof files[path] === "number" ? new Response(null, { status: files[path] }) : new Response(files[path], { status: 200 });
    }
    if (!path.startsWith("artifacts/")) return new Response(null, { status: 404 });
    try {
      return new Response(fixtureBytes(path), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
