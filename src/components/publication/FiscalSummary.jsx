import { provisionalLabel } from "../../utils/publication/manifest";
import {
  fiscalYearLabel,
  formatBillions,
} from "../../utils/publication/format";
import "./publication.css";

function Cell({ value, reason }) {
  if (value === null) {
    return (
      <td className="publication-cell-unavailable" aria-label={reason}>
        <span aria-hidden="true">—</span>
      </td>
    );
  }
  return <td>{formatBillions(value)}</td>;
}

/**
 * Fiscal impact by year: each measure alone, the combined run and the
 * interaction between them. A figure that is not published shows a dash,
 * with the reason for screen readers and on hover.
 *
 * The provisional label is the manifest's (provisionalLabel): candidates
 * before the Budget, statement figures from Budget day.
 *
 * @param {{series: Array<Object>, ids: Array<string>,
 *   measureNames?: Object<string, string>, manifest?: Object|null}} props
 */
function FiscalSummary({ series, ids, measureNames = {}, manifest = null }) {
  const name = (id) => measureNames[id] ?? id;
  const several = ids.length > 1;
  const provisional = series.some((row) => row.provisional);
  return (
    <div className="publication-fiscal">
      {provisional && (
        <p className="publication-provisional">{provisionalLabel(manifest)}</p>
      )}
      <table>
        <caption>
          Budgetary impact (£bn, positive improves the public finances)
        </caption>
        <thead>
          <tr>
            <th scope="col">Policy</th>
            {series.map((row) => (
              <th scope="col" key={row.year}>
                {fiscalYearLabel(row.year)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <th scope="row">
                {name(id)}
                {series.some((row) => row.provisionalIds.includes(id)) && (
                  <span className="publication-provisional-marker">
                    {" "}
                    (provisional)
                  </span>
                )}
              </th>
              {series.map((row) => (
                <Cell
                  key={row.year}
                  value={row.standalone[id]}
                  reason={row.reasons[id]}
                />
              ))}
            </tr>
          ))}
          {several && (
            <tr className="publication-row-combined">
              <th scope="row">Combined</th>
              {series.map((row) => (
                <Cell
                  key={row.year}
                  value={row.combined}
                  reason={row.combinedReason}
                />
              ))}
            </tr>
          )}
          {several && (
            <tr className="publication-row-interaction">
              <th scope="row">Interaction</th>
              {series.map((row) => (
                <Cell
                  key={row.year}
                  value={row.interaction}
                  reason="Needs the combined run and every policy alone"
                />
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default FiscalSummary;
