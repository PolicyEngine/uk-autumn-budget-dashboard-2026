// Writes src/components/landing/silhouette.json: the shape of the Revenue
// impact chart for the landing page's background (LandingBackdrop.jsx),
// so it paints at once with no data to fetch. Only bar geometry: each
// measure's direction, its size rank within it, and its £bn by year
// (one decimal); no names, no labels, never shown as numbers.
//
//   node scripts/landing-silhouette.mjs
//
// Re-run when a published measure's budgetary_impact.csv changes: it reads
// each measure the manifest lists, from its approved artifact.
import { readFileSync, writeFileSync } from "node:fs";

const data = new URL("../public/data/", import.meta.url);
const { measures: published } = JSON.parse(readFileSync(new URL("manifest.json", data), "utf8"));
const rows = Object.entries(published).flatMap(([id, { artifact }]) =>
  readFileSync(new URL(`${artifact}/budgetary_impact.csv`, data), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      return { id: cells[0], year: Number(cells.at(-2)), value: Number(cells.at(-1)) };
    })
    .filter((row) => row.id === id && Number.isFinite(row.value)),
);

const years = [...new Set(rows.map((row) => row.year))].sort();
const ids = [...new Set(rows.map((row) => row.id))];
const measures = ids.map((id) => {
  const own = rows.filter((row) => row.id === id);
  const total = own.reduce((sum, row) => sum + row.value, 0);
  return {
    id,
    direction: total >= 0 ? "revenue" : "cost",
    size: own.reduce((sum, row) => sum + Math.abs(row.value), 0),
    values: years.map((year) => Math.round((own.find((row) => row.year === year)?.value ?? 0) * 10) / 10),
  };
});
for (const direction of ["revenue", "cost"]) {
  const group = measures.filter((m) => m.direction === direction).sort((a, b) => b.size - a.size);
  group.forEach((m, rank) => {
    m.rank = rank;
    m.of = group.length;
  });
}
const out = {
  years,
  bars: measures.map(({ direction, rank, of, values }) => ({ direction, rank, of, values })),
};
writeFileSync(new URL("../src/components/landing/silhouette.json", import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`${out.bars.length} measures, ${years.length} years`);
