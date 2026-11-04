import UnavailableNotice, { RemoveUnavailable } from "./UnavailableNotice";

/**
 * Selected measures a view cannot show, each with why, and the way to take
 * them out of the selection. Never stands in for a number.
 *
 * @param {Object} props
 * @param {string} props.reason - The notice's heading
 * @param {string} props.summary - What the measures have in common
 * @param {Array<{id: string, name: string, why: string[]}>} props.measures
 * @param {(ids: string[]) => void} [props.onRemove]
 */
function UnavailableMeasures({ reason, summary, measures, onRemove }) {
  return (
    <UnavailableNotice reason={reason}>
      <p>{summary}</p>
      <ul className="publication-unavailable-list">
        {measures.map((measure) => (
          <li key={measure.id}>
            {measure.name}: {measure.why.join("; ")}
          </li>
        ))}
      </ul>
      {onRemove && (
        <RemoveUnavailable
          names={measures.map((measure) => measure.name)}
          onRemove={() => onRemove(measures.map((measure) => measure.id))}
        />
      )}
    </UnavailableNotice>
  );
}

export default UnavailableMeasures;
