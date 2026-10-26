/**
 * The constituencies as a hex cartogram: one equal hexagon per seat, so
 * London's and the cities' small seats read as clearly as rural ones.
 *
 * The layout and the drawing are ported from María Juaristi's constituency
 * hex map for the high value council tax surcharge post
 * (PolicyEngine/uk-mansion-tax, create_estimates_2028_29_map.py at
 * 599f41d1f33cc616d20270d197bafe9ceaf31cbd: hex_centres() and hexPath()).
 * Her estimates_2028_29/constituencies_2024_hex.csv holds England's 543
 * seats; it is a subset of the file used here, the Open Innovations HexJSON
 * of all 650 2024 Westminster constituencies
 * (open-innovations/constituencies, src/_data/hexjson/
 * uk-constituencies-2024.hexjson, file commit 1d43262f; visualisations
 * CC BY 4.0, Open Innovations), with identical q and r for every English
 * seat. data_inputs/constituency_hexes.json keeps only each seat's [q, r], by GSS code.
 */

import HEXES from "../../../data_inputs/constituency_hexes.json";

/** Each seat's [q, r] in the odd-r layout, by GSS code. */
export const CONSTITUENCY_HEXES = HEXES;

/** A hexagon's radius as a share of the spacing, leaving a thin gap. */
const HEX_RADIUS = 0.98;

/**
 * A seat's centre in hex units: pointy-top hexes, odd rows shifted right
 * by half a hex, y growing northward in the layout (so negated here, for
 * SVG's downward y). Math.abs, as JavaScript's % keeps the sign of r.
 */
export function hexCentre([q, r]) {
  return [(q + (Math.abs(r) % 2) * 0.5) * Math.sqrt(3), -r * 1.5];
}

/** A pointy-top hexagon's SVG path around (cx, cy). */
export function hexPath(cx, cy, radius) {
  const points = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
}

/**
 * Every seat's hexagon fitted into a width × height drawing area with
 * `padding` on each side, centred, as the boundary map is fitted.
 *
 * @param {string[]} codes - The seats to place (those without a hex are left out)
 * @returns {{paths: Map<string, string>, bounds: Map<string, number[][]>,
 *   radius: number, missing: string[]}}
 */
export function fitHexes(codes, { width, height, padding = 20, hexes = CONSTITUENCY_HEXES }) {
  const placed = codes.filter((code) => hexes[code]);
  const missing = codes.filter((code) => !hexes[code]);
  const centres = new Map(placed.map((code) => [code, hexCentre(hexes[code])]));
  const xs = [...centres.values()].map(([x]) => x);
  const ys = [...centres.values()].map(([, y]) => y);
  // A hexagon reaches √3/2 of its radius sideways and its radius up and down
  const xMin = Math.min(...xs) - (Math.sqrt(3) / 2) * HEX_RADIUS;
  const xMax = Math.max(...xs) + (Math.sqrt(3) / 2) * HEX_RADIUS;
  const yMin = Math.min(...ys) - HEX_RADIUS;
  const yMax = Math.max(...ys) + HEX_RADIUS;
  const scale = Math.min(
    (width - 2 * padding) / (xMax - xMin),
    (height - 2 * padding) / (yMax - yMin),
  );
  const offsetX = (width - (xMax - xMin) * scale) / 2;
  const offsetY = (height - (yMax - yMin) * scale) / 2;
  const radius = HEX_RADIUS * scale;
  const paths = new Map();
  const bounds = new Map();
  for (const [code, [x, y]] of centres) {
    const cx = (x - xMin) * scale + offsetX;
    const cy = (y - yMin) * scale + offsetY;
    paths.set(code, hexPath(cx, cy, radius));
    bounds.set(code, [
      [cx - (Math.sqrt(3) / 2) * radius, cy - radius],
      [cx + (Math.sqrt(3) / 2) * radius, cy + radius],
    ]);
  }
  return { paths, bounds, radius, missing };
}
