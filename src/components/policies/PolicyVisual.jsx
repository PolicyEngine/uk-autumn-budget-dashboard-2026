import { useRef } from "react";
import "./PolicyVisual.css";
import { useWidth } from "../../utils/useWidth";
import {
  busFareCapView,
  carersTaperView,
  electricityVatView,
  energyReachView,
  fuelDutyView,
  longMonth,
  pensionAllowanceView,
  percent,
  pounds,
  propertyRatesView,
  shortMonth,
  tradingAllowanceView,
  wholePounds,
} from "../../utils/policyVisuals";

/*
 * One visual per modelled measure on the Policies tab, each drawn from its
 * entry in policy_parameters.json and its card details (policyDetails.js
 * `visual`; the numbers: utils/policyVisuals.js). Each is one image with
 * a text alternative (role="img" and an aria-label that says what it
 * shows, figures included), plain SVG or HTML in the dashboard's tokens,
 * and still: no motion to reduce.
 */

const MINUS = "−";
const pence = (value) => `${value.toFixed(2)}p`;

/** An SVG plot's frame: a measured width, a fixed height. */
function Plot({ height, label, className, children }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  return (
    <div className="pviz-plot" ref={wrap}>
      <svg
        className={`pviz-svg ${className ?? ""}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
      >
        {children(width)}
      </svg>
    </div>
  );
}

/** A key: each item a swatch class and its words. */
const Key = ({ items }) => (
  <p className="pviz-key" aria-hidden="true">
    {items.map(([swatch, words]) => (
      <span key={words} className={`pviz-key-item is-${swatch}`}>
        {words}
      </span>
    ))}
  </p>
);

// --- Fuel duty ----------------------------------------------------------------

const FUEL_HEIGHT = 150;
const FUEL_MARGIN = { top: 22, right: 12, bottom: 24, left: 52 };

/**
 * Pence a litre month by month around the cut: current law dashed, the
 * measure in its colour, the gap shaded and its largest labelled, Budget
 * day marked; under it, the duty saved on a fill in each period.
 */
export function FuelDutyVisual({ entry, visual, name }) {
  const view = fuelDutyView(entry, visual);
  if (!view) return null;
  const { start, end, steps, cuts, low, high, largest, litres } = view;
  const pad = (high - low) * 0.22;
  const lo = low - pad;
  const hi = high + pad;
  const description =
    `${name}: fuel duty, pence a litre, ${shortMonth(view.window.from, true)} to ${shortMonth(view.window.to, true)}. ` +
    cuts.map((cut) => `${cut.months}: ${pence(cut.after)} instead of ${pence(cut.before)}, ${pounds(cut.fill)} less duty on a ${litres}-litre fill`).join("; ") +
    ". From July 2027 the two rates are the same.";
  // Quarter ticks: the window's first month and every third after
  const quarters = [];
  for (let month = start; month <= end + 1e-9; month += 3) quarters.push(month);
  const monthIso = (month) => {
    const index = 2026 * 12 + 3 + Math.round(month);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  // Budget day, 28 October 2026, as months since April 2026
  const budget = 6 + 27 / 31;
  return (
    <figure className="pviz pviz-fuel">
      <div className="pviz-head">
        <p className="pviz-caption">Duty, pence a litre</p>
        <Key items={[["before", "Current law"], ["after", "With the policy"]]} />
      </div>
      <Plot height={FUEL_HEIGHT} label={description} className="is-gain">
        {(width) => {
          const plotW = Math.max(width - FUEL_MARGIN.left - FUEL_MARGIN.right, 60);
          const plotH = FUEL_HEIGHT - FUEL_MARGIN.top - FUEL_MARGIN.bottom;
          const x = (month) => FUEL_MARGIN.left + ((month - start) / (end - start)) * plotW;
          const y = (value) => FUEL_MARGIN.top + (1 - (value - lo) / (hi - lo)) * plotH;
          const path = (key) => steps.map((s, i) => `${i ? "L" : "M"}${x(s.start).toFixed(1)},${y(s[key]).toFixed(1)}H${x(s.end).toFixed(1)}`).join("");
          const gap = steps
            .filter((s) => s.before !== s.after)
            .map((s) => `M${x(s.start).toFixed(1)},${y(s.before).toFixed(1)}H${x(s.end).toFixed(1)}V${y(s.after).toFixed(1)}H${x(s.start).toFixed(1)}Z`)
            .join("");
          const big = steps.find((s) => s.before === largest.before && s.after === largest.after);
          const narrow = plotW < 330;
          return (
            <>
              {quarters.map((month) => (
                <line key={month} className="pviz-grid" x1={x(month)} x2={x(month)} y1={FUEL_MARGIN.top} y2={FUEL_MARGIN.top + plotH} />
              ))}
              <line className="pviz-axis" x1={FUEL_MARGIN.left} x2={FUEL_MARGIN.left + plotW} y1={FUEL_MARGIN.top + plotH} y2={FUEL_MARGIN.top + plotH} />
              {[low, high].map((value) => (
                <text key={value} className="pviz-tick" x={FUEL_MARGIN.left - 6} y={y(value)} dy="0.32em" textAnchor="end">
                  {pence(value)}
                </text>
              ))}
              {quarters.map((month, i) => (
                <text
                  key={month}
                  className="pviz-tick"
                  x={x(month)}
                  y={FUEL_HEIGHT - 6}
                  textAnchor={i === 0 ? "start" : i === quarters.length - 1 ? "end" : "middle"}
                >
                  {shortMonth(monthIso(month), narrow ? monthIso(month).endsWith("-01") : i === 0 || monthIso(month).endsWith("-01"))}
                </text>
              ))}
              <line className="pviz-budget" x1={x(budget)} x2={x(budget)} y1={FUEL_MARGIN.top - 6} y2={FUEL_MARGIN.top + plotH} />
              <text className="pviz-budget-label" x={x(budget) + 4} y={FUEL_MARGIN.top - 8}>
                Budget
              </text>
              <path className="pviz-gap" d={gap} />
              <path className="pviz-before" d={path("before")} />
              <path className="pviz-after-casing" d={path("after")} />
              <path className="pviz-after" d={path("after")} />
              {big && (
                <text
                  className="pviz-gap-label"
                  x={(x(big.start) + x(big.end)) / 2}
                  y={(y(big.before) + y(big.after)) / 2 + 4}
                  textAnchor="middle"
                >
                  {MINUS}
                  {pence(largest.gap).replace(/\.?0+p$/, "p")}
                </text>
              )}
            </>
          );
        }}
      </Plot>
      <figcaption className="pviz-fills">
        <span className="pviz-fills-title">Duty saved on a {litres}-litre fill</span>
        <span className="pviz-fills-list">
          {cuts.map((cut) => (
            <span key={cut.key} className="pviz-fill">
              <span className="pviz-fill-when">{cut.months}</span>
              <span className="pviz-fill-value">{pounds(cut.fill)}</span>
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

// --- Carer's Allowance ------------------------------------------------------

const CARER_HEIGHT = 160;
const CARER_MARGIN = { top: 16, right: 14, bottom: 34, left: 52 };

/**
 * The allowance against weekly earnings: current law pays the full rate up
 * to the limit and nothing beyond it (the cliff, in the loss colour); the
 * measure tapers it £1 for £1 to where it runs out, the triangle it keeps
 * shaded as a gain. The row's note, under it, says it in words.
 */
export function CarersTaperVisual({ entry, name }) {
  const view = carersTaperView(entry);
  if (!view) return null;
  const { year, limit, runsOut, rate, note } = view;
  const xMax = runsOut + (runsOut - limit) * 0.45;
  const yMax = rate * 1.18;
  const description =
    `${name}, ${year}: Carer's Allowance against weekly earnings. Current law pays ${pounds(rate)} a week up to the earnings limit of ${wholePounds(limit)} and nothing at £1 over it, a cliff edge. ` +
    `With the measure it falls by £1 for each £1 above the limit and runs out at ${wholePounds(runsOut)} a week.`;
  return (
    <figure className="pviz pviz-carers">
      <div className="pviz-head">
        <p className="pviz-caption">Carer's Allowance, £ a week, {year}</p>
        <Key items={[["before", "Current law"], ["cliff", "Cliff edge"], ["after", "With the policy"]]} />
      </div>
      <Plot height={CARER_HEIGHT} label={description} className="is-gain">
        {(width) => {
          const plotW = Math.max(width - CARER_MARGIN.left - CARER_MARGIN.right, 60);
          const plotH = CARER_HEIGHT - CARER_MARGIN.top - CARER_MARGIN.bottom;
          const x = (value) => CARER_MARGIN.left + (value / xMax) * plotW;
          const y = (value) => CARER_MARGIN.top + (1 - value / yMax) * plotH;
          const base = y(0);
          const narrow = plotW < 330;
          const slopeMid = { x: x((limit + runsOut) / 2), y: y(rate / 2) };
          return (
            <>
              <line className="pviz-axis" x1={CARER_MARGIN.left} x2={CARER_MARGIN.left + plotW} y1={base} y2={base} />
              {[0, rate].map((value) => (
                <text key={value} className="pviz-tick" x={CARER_MARGIN.left - 6} y={y(value)} dy="0.32em" textAnchor="end">
                  {value ? pounds(value) : "£0"}
                </text>
              ))}
              {[0, limit, runsOut].map((value) => (
                <text key={value} className="pviz-tick" x={x(value)} y={base + 15} textAnchor={value ? "middle" : "start"}>
                  {wholePounds(value)}
                </text>
              ))}
              <text className="pviz-axis-title" x={CARER_MARGIN.left + plotW} y={CARER_HEIGHT - 3} textAnchor="end">
                Weekly earnings
              </text>
              {/* What the taper keeps that current law takes away */}
              <path className="pviz-gap" d={`M${x(limit)},${y(rate)}L${x(runsOut)},${base}L${x(limit)},${base}Z`} />
              {/* Current law: the full rate, the cliff, then nothing */}
              <path className="pviz-before" d={`M${x(0)},${y(rate)}H${x(limit)}M${x(limit)},${base}H${x(xMax)}`} />
              <path className="pviz-after-casing" d={`M${x(0)},${y(rate)}H${x(limit)}L${x(runsOut)},${base}H${x(xMax)}`} />
              <path className="pviz-after" d={`M${x(0)},${y(rate)}H${x(limit)}L${x(runsOut)},${base}H${x(xMax)}`} />
              <line className="pviz-cliff" x1={x(limit)} x2={x(limit)} y1={y(rate)} y2={base} />
              <text className="pviz-cliff-label" x={x(limit) - 7} y={y(rate * 0.45)} textAnchor="end">
                {narrow ? "Cliff" : "Cliff edge"}
              </text>
              <text className="pviz-gap-label" x={slopeMid.x + 8} y={slopeMid.y - 6}>
                £1 for £1
              </text>
            </>
          );
        }}
      </Plot>
      <figcaption className="pchg-caption pchg-note">{note}</figcaption>
    </figure>
  );
}

// --- Household Energy Payment ------------------------------------------------

/**
 * Who the payment reaches: England's council tax bands, the four it is paid
 * in marked, then the shares the Budget states as bars, all households
 * first.
 */
export function EnergyReachVisual({ entry, visual, name }) {
  const view = energyReachView(entry, visual);
  if (!view) return null;
  const { amount, bands, paid, millions, share, totalMillions, groups } = view;
  const rows = [
    { label: "All households in England", share, note: `up to ${millions} million of about ${totalMillions} million` },
    ...groups,
  ];
  const description =
    `${name}: ${wholePounds(amount)} once to households in council tax bands ${paid[0]} to ${paid[paid.length - 1]}, ${paid.length} of England's ${bands.length}. ` +
    rows.map((row) => `${row.label}: ${row.note ? `${row.note} households, ` : ""}about ${percent(row.share)} reached`).join("; ") +
    ".";
  return (
    <div className="pviz pviz-energy" role="img" aria-label={description}>
      <div className="pviz-bands" aria-hidden="true">
        <span className="pviz-bands-title">Council tax band</span>
        <span className="pviz-bands-row">
          {bands.map((band) => (
            <span key={band} className={`pviz-band${paid.includes(band) ? " is-paid" : ""}`}>
              {band}
            </span>
          ))}
        </span>
        <span className="pviz-bands-paid" style={{ "--paid": paid.length, "--bands": bands.length }}>
          {wholePounds(amount)} each
        </span>
      </div>
      <ul className="pviz-bars" aria-hidden="true">
        {rows.map((row) => (
          <li key={row.label} className="pviz-bar-row">
            <span className="pviz-bar-label">
              {row.label}
              {row.note && <span className="pviz-bar-note"> ({row.note})</span>}
            </span>
            <span className="pviz-bar-track">
              <span className="pviz-bar-fill" style={{ width: `${row.share * 100}%` }} />
            </span>
            <span className="pviz-bar-value">{percent(row.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Trading allowance -----------------------------------------------------

/**
 * The tax-free band on £0 to the new allowance: current law's part grey,
 * the part the measure adds in its colour, the example's side income
 * marked at its end with the tax it saves.
 */
export function TradingAllowanceVisual({ entry, visual, name, example: card }) {
  const view = tradingAllowanceView(entry, visual);
  if (!view) return null;
  const { before, after, year, example } = view;
  const share = (value) => `${(value / after) * 100}%`;
  const description =
    `${name}: the trading allowance, from ${wholePounds(before)} to ${wholePounds(after)} of trading income a year free of tax from ${year}. ` +
    `Example: an employee on ${wholePounds(example.income)} with ${wholePounds(example.sideIncome)} of side income and no expenses pays ${wholePounds(example.saving)} less income tax.`;
  return (
    <div className="pviz pviz-trading" role="img" aria-label={description}>
      <div className="pviz-band-bar" aria-hidden="true">
        <span className="pviz-band-old" style={{ width: share(before) }}>
          <span>Tax-free now</span>
        </span>
        <span className="pviz-band-new" style={{ width: share(after - before) }}>
          <span>{wholePounds(after - before)} more tax-free</span>
        </span>
      </div>
      <div className="pviz-band-ticks" aria-hidden="true">
        <span style={{ left: 0 }}>£0</span>
        <span style={{ left: share(before) }}>{wholePounds(before)}</span>
        <span style={{ left: share(after) }}>{wholePounds(after)}</span>
      </div>
      {/* The card's example, its saving picked out */}
      {card?.text && (
        <p className="pviz-band-saving" aria-hidden="true">
          {card.text.split(wholePounds(example.saving)).flatMap((part, i) =>
            i ? [<strong key={i} className="pviz-band-saving-value">{wholePounds(example.saving)}</strong>, part] : [part],
          )}
        </p>
      )}
    </div>
  );
}

// --- Zero VAT on electricity ---------------------------------------------------

/**
 * VAT month by month for Great Britain and Northern Ireland: 0% in the
 * measure's colour (striped where the Budget only expects it), 5% grey,
 * the months already zero-rated in law before the Budget bracketed above.
 * The row's note, under it, says it in words.
 */
export function ElectricityVatVisual({ entry, visual, name }) {
  const view = electricityVatView(entry, visual);
  if (!view) return null;
  const { before, after, months, regions, law, note } = view;
  const count = months.length;
  const description =
    `${name}: VAT on household electricity, ${percent(after)} instead of ${percent(before)}. ` +
    regions
      .map((region) => `${region.name}: ${percent(after)} from ${longMonth(region.from)} to ${longMonth(region.to)}${region.expected ? " (expected)" : ""}`)
      .join("; ") +
    (law ? `. ${longMonth(law.from)} to ${longMonth(law.to)} was already law before the Budget.` : ".");
  return (
    <figure className="pviz pviz-vat">
      <div className="pviz-head">
        <p className="pviz-caption">VAT on household electricity</p>
        <Key items={[["zero", percent(after)], ["standard", percent(before)], ["expected", `${percent(after)}, expected`]]} />
      </div>
      <div className="pviz-cal" role="img" aria-label={description} style={{ "--months": count }}>
        {law && law.first >= 0 && law.last >= law.first && (
          <div className="pviz-cal-row" aria-hidden="true">
            <span className="pviz-cal-name" />
            <span className="pviz-cal-cells">
              <span className="pviz-cal-law" style={{ gridColumn: `${law.first + 1} / span ${law.last - law.first + 1}` }}>
                {law.label}
              </span>
            </span>
          </div>
        )}
        {regions.map((region) => (
          <div key={region.name} className="pviz-cal-row" aria-hidden="true">
            <span className="pviz-cal-name">{region.name}</span>
            <span className="pviz-cal-cells">
              {region.cells.map((cell) => (
                <span
                  key={cell.month}
                  className={`pviz-cal-cell${cell.zero ? (region.expected ? " is-expected" : " is-zero") : ""}`}
                />
              ))}
            </span>
          </div>
        ))}
        <div className="pviz-cal-row is-months" aria-hidden="true">
          <span className="pviz-cal-name" />
          <span className="pviz-cal-cells">
            {months.map((month, i) => (
              <span key={month} className="pviz-cal-month">
                <span className="pviz-cal-letter">{shortMonth(month).slice(0, 1)}</span>
                {(i === 0 || month.endsWith("-01")) && <span className="pviz-cal-year">{month.slice(0, 4)}</span>}
              </span>
            ))}
          </span>
        </div>
      </div>
      {note && <figcaption className="pchg-caption pchg-note">{note}</figcaption>}
    </figure>
  );
}

// --- Property income tax ---------------------------------------------------

/**
 * The three property income rates as a ladder on 0% to 50%: current law's
 * rate grey, the measure's two points on top in its colour.
 */
export function PropertyRatesVisual({ entry, visual, name }) {
  const view = propertyRatesView(entry);
  if (!view) return null;
  const { year, rates } = view;
  const scale = 0.5;
  const width = (value) => `${(value / scale) * 100}%`;
  const description =
    `${name}, from ${year}${visual?.where ? `, in ${visual.where}` : ""}: ` +
    rates.map((rate) => `${rate.label} ${percent(rate.before)} to ${percent(rate.after)}`).join(", ") +
    ".";
  return (
    <figure className="pviz pviz-rates">
      <div className="pviz-head">
        <p className="pviz-caption">Property income tax rates, from {year}</p>
      </div>
      <ul className="pviz-ladder" role="img" aria-label={description}>
        {rates.map((rate) => (
          <li key={rate.label} className="pviz-rung" aria-hidden="true">
            <span className="pviz-rung-label">{rate.label}</span>
            <span className="pviz-rung-track">
              <span className="pviz-rung-before" style={{ width: width(rate.before) }} />
              <span className="pviz-rung-after" style={{ left: width(rate.before), width: width(rate.after - rate.before) }} />
            </span>
            <span className="pviz-rung-value">
              <span className="pviz-rung-old">{percent(rate.before)}</span> → {percent(rate.after)}
            </span>
          </li>
        ))}
      </ul>
      {visual?.where && <p className="pviz-where">{visual.where} only; not Scotland</p>}
    </figure>
  );
}

// --- Pension Tax Allowance -----------------------------------------------------

const PTA_HEIGHT = 160;
const PTA_MARGIN = { top: 18, right: 14, bottom: 34, left: 44 };

/**
 * The allowance against total income in one year: the full amount up to
 * the full new State Pension, then £1 less for every £3 above it to where
 * it is gone; the explainer's examples as dots.
 */
export function PensionAllowanceVisual({ entry, visual, name }) {
  const view = pensionAllowanceView(entry, visual);
  if (!view) return null;
  const { year, largest, fullPension, goneAt, taper, examples, at } = view;
  const span = goneAt - fullPension;
  const xMin = fullPension - span * 0.6;
  const xMax = goneAt + span * 0.35;
  const yMax = largest * 1.22;
  const description =
    `${name}, ${year}: the allowance against total income. ${wholePounds(largest)} up to the full new State Pension (${wholePounds(fullPension)}), ` +
    `then £1 less for every £${taper} of income above it, gone at about ${wholePounds(goneAt)}. ` +
    examples.map((example) => `At ${wholePounds(example.income)}: ${wholePounds(example.allowance)}${example.label ? ` (${example.label.toLowerCase()})` : ""}`).join("; ") +
    ".";
  return (
    <figure className="pviz pviz-pta">
      <div className="pviz-head">
        <p className="pviz-caption">{name}, £ a year, {year}</p>
        <Key items={[["after", "Allowance"], ["dot", "Explainer's examples"]]} />
      </div>
      <Plot height={PTA_HEIGHT} label={description} className="is-gain">
        {(width) => {
          const plotW = Math.max(width - PTA_MARGIN.left - PTA_MARGIN.right, 60);
          const plotH = PTA_HEIGHT - PTA_MARGIN.top - PTA_MARGIN.bottom;
          const x = (value) => PTA_MARGIN.left + ((value - xMin) / (xMax - xMin)) * plotW;
          const y = (value) => PTA_MARGIN.top + (1 - value / yMax) * plotH;
          const base = y(0);
          const line = `M${x(xMin)},${y(largest)}H${x(fullPension)}L${x(goneAt)},${base}H${x(xMax)}`;
          const narrow = plotW < 330;
          return (
            <>
              <line className="pviz-axis" x1={PTA_MARGIN.left} x2={PTA_MARGIN.left + plotW} y1={base} y2={base} />
              {[0, largest].map((value) => (
                <text key={value} className="pviz-tick" x={PTA_MARGIN.left - 6} y={y(value)} dy="0.32em" textAnchor="end">
                  {wholePounds(value)}
                </text>
              ))}
              {[fullPension, goneAt].map((value, i) => (
                <text key={value} className="pviz-tick" x={x(value)} y={base + 15} textAnchor="middle">
                  {i ? `about ${wholePounds(value)}` : wholePounds(value)}
                </text>
              ))}
              <text className="pviz-axis-title" x={PTA_MARGIN.left + plotW} y={PTA_HEIGHT - 3} textAnchor="end">
                Total income
              </text>
              <path className="pviz-gap" d={`${line}V${base}H${x(xMin)}Z`} />
              <path className="pviz-after-casing" d={line} />
              <path className="pviz-after" d={line} />
              {/* Inside the shaded area, under the slope */}
              <text className="pviz-gap-label" x={x(fullPension + span * 0.22)} y={y(largest * 0.22)} textAnchor="middle">
                £1 per £{taper}
              </text>
              {examples.map((example, i) => {
                const cx = x(example.income);
                const cy = y(at(example.income));
                const first = i === 0;
                return (
                  <g key={example.income}>
                    <circle className="pviz-dot" cx={cx} cy={cy} r={4.5} />
                    <text
                      className="pviz-dot-label"
                      x={first ? cx : cx + 8}
                      y={first ? cy - 9 : cy + 4}
                      textAnchor={first ? "middle" : "start"}
                    >
                      {first && example.label && !narrow ? example.label : first ? "No income tax" : `${wholePounds(example.income)}: ${wholePounds(example.allowance)}`}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </figure>
  );
}

// --- Bus fare cap -------------------------------------------------------------

const BUS_HEIGHT = 64;

/**
 * The single fare cap as two columns, £3 grey and £2 in the measure's
 * colour, and under them the card's example with each year's saving
 * picked out.
 */
export function BusFareCapVisual({ entry, visual, name, example: card }) {
  const view = busFareCapView(entry, visual);
  if (!view) return null;
  const { before, after, window, share, example } = view;
  const years = Object.entries(example.saved);
  const description =
    `${name}: single bus fares capped at ${wholePounds(after)} instead of ${wholePounds(before)}, ${window}. ` +
    `Modelled as ${percent(share)} of bus fare spending at ${wholePounds(before)} fares while the cap runs. ` +
    `Example: a household in England outside London with ${wholePounds(example.spending)} a year of bus fares gets ` +
    years.map(([year, value]) => `${wholePounds(value)} in ${year}`).join(" and ") +
    ".";
  const columns = [
    { label: "Without the cap", value: before, tone: "before" },
    { label: window, value: after, tone: "after" },
  ];
  const saved = years.map(([, value]) => wholePounds(value));
  return (
    <div className="pviz pviz-bus" role="img" aria-label={description}>
      <div className="pviz-bus-columns" aria-hidden="true">
        {columns.map((column) => (
          <div className="pviz-bus-column" key={column.label}>
            <span className="pviz-bus-area">
              <span className="pviz-bus-value">{wholePounds(column.value)}</span>
              <span className={`pviz-bus-bar is-${column.tone}`} style={{ height: `${Math.round((BUS_HEIGHT * column.value) / before)}px` }} />
            </span>
            <span className="pviz-bus-label">{column.label}</span>
          </div>
        ))}
      </div>
      {/* The card's example, each year's saving picked out */}
      {card?.text && (
        <p className="pviz-band-saving" aria-hidden="true">
          {card.text.split(new RegExp(`(${saved.join("|")})`)).map((part, i) =>
            saved.includes(part) ? (
              <strong key={i} className="pviz-band-saving-value">
                {part}
              </strong>
            ) : (
              part
            ),
          )}
        </p>
      )}
    </div>
  );
}

// --- Dispatch ----------------------------------------------------------------

const VISUALS = {
  "fuel-duty": FuelDutyVisual,
  "carers-taper": CarersTaperVisual,
  "energy-reach": EnergyReachVisual,
  "trading-allowance": TradingAllowanceVisual,
  "electricity-vat": ElectricityVatVisual,
  "property-rates": PropertyRatesVisual,
  "pension-tax-allowance": PensionAllowanceVisual,
  "bus-fare-cap": BusFareCapVisual,
};

/**
 * A measure's visual, or null: none for a measure without one, or whose
 * data are missing or disagree (the card then shows what it did before).
 */
export function policyVisual(policy, entry) {
  const Visual = VISUALS[policy?.visual?.kind];
  if (!Visual || !entry) return null;
  const props = { entry, visual: policy.visual, name: policy.label ?? policy.name, example: policy.example };
  // Rendered only where the numbers hold: each view returns null otherwise
  const ok = {
    "fuel-duty": () => fuelDutyView(entry, policy.visual),
    "carers-taper": () => carersTaperView(entry),
    "energy-reach": () => energyReachView(entry, policy.visual),
    "trading-allowance": () => tradingAllowanceView(entry, policy.visual),
    "electricity-vat": () => electricityVatView(entry, policy.visual),
    "property-rates": () => propertyRatesView(entry),
    "pension-tax-allowance": () => pensionAllowanceView(entry, policy.visual),
    "bus-fare-cap": () => busFareCapView(entry, policy.visual),
  }[policy.visual.kind]();
  return ok ? <Visual {...props} /> : null;
}
