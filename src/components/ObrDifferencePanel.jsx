import MeasureRowLabel from "./MeasureRowLabel";
import { formatBn, formatDifference, rowDecimals, shownDifference } from "./OBRDumbbellChart";
import { NOT_COMPARABLE_SHORT, basisSides, pointsForYear } from "../utils/obrDeviationNotes";
import "./ObrDifferencePanel.css";

const isValue = (value) => typeof value === "number" && Number.isFinite(value);
// A basis fragment as a line of its own: capital first
const line = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Why the selected policy's estimate differs from the official costing,
 * beside the comparison chart (Vahid, 28 October): the policy, the two
 * figures for the year and the gap, what each side counts, then the
 * reasons as short points, each tagged with its kind. Fragments only, no
 * paragraphs. A row with no comparison this year (not comparable, not in
 * the official costings, not in force) says why in one line.
 *
 * `row`: a comparisonRows() row with `panelBasis` ({ official, ours }), or
 * `basis` (the "Official: …. Ours: …." line), and `points` (the policy's
 * OBR_DIFFERENCE_POINTS, shown for `year`).
 */
export default function ObrDifferencePanel({ row, year, yearLabel, obrKind }) {
  if (!row) return null;
  const decimals = rowDecimals(row.pe, row.obr);
  const paired = isValue(row.pe) && isValue(row.obr);
  const difference = paired ? shownDifference(row.pe, row.obr, decimals) : null;
  const sides = row.panelBasis ?? basisSides(row.basis);
  const points = pointsForYear(row.points, year);
  // One line where there is nothing to compare this year
  const why = row.status
    ? row.status
    : row.notComparable !== null && row.notComparable !== undefined
      ? [`Not comparable in ${yearLabel}.`, points.some((point) => point.text === NOT_COMPARABLE_SHORT[row.id]) ? null : NOT_COMPARABLE_SHORT[row.id] ?? "See the note under the table."].filter(Boolean).join(" ")
      : !isValue(row.obr)
        ? `No official figure for ${yearLabel}.`
        : !isValue(row.pe)
          ? `We have not yet published ours for ${yearLabel}.`
          : null;
  return (
    <aside className="obr-panel" aria-label={`Why ours differs: ${row.name}`} aria-live="polite">
      {/* Keyed by policy: a new selection fades and slides in */}
      <div className="obr-panel-body" key={row.id}>
      <p className="obr-panel-name">
        <MeasureRowLabel measure={row.measure ?? { id: row.id, name: row.name }} name={row.name} tip={false} />
      </p>
      {why ? (
        <p className="obr-panel-why">{why}</p>
      ) : (
        <dl className="obr-panel-figures">
          <div>
            <dt><span className="obr-panel-key is-ours" aria-hidden="true" />Ours</dt>
            <dd className="is-ours">{formatBn(row.pe, decimals)}</dd>
          </div>
          <div>
            <dt title={`Official costing (${obrKind})`}><span className="obr-panel-key is-official" aria-hidden="true" />Official</dt>
            <dd>{formatBn(row.obr, decimals)}</dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd>{formatDifference(difference, decimals)}</dd>
          </div>
        </dl>
      )}
      {sides && (
        <dl className="obr-panel-basis">
          <div>
            <dt>Official counts</dt>
            <dd>{line(sides.official)}</dd>
          </div>
          <div>
            <dt>We count</dt>
            <dd>{line(sides.ours)}</dd>
          </div>
        </dl>
      )}
      {points.length > 0 && (
        <>
          <p className="obr-panel-head">Why they differ</p>
          <ul className="obr-panel-points">
            {points.map((point) => (
              <li key={`${point.reason}|${point.text}`}>
                {point.reason && <span className="obr-panel-chip">{point.reason}</span>}
                <span>{point.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
    </aside>
  );
}
