import Note from "./Note";
import { zeroReason } from "../utils/legendMembership";

const fiscalYear = (year) => `${year}-${String(year + 1).slice(-2)}`;

/**
 * One line under a household chart naming the selected measures that are
 * £0 for households in the year shown, and why: they are greyed out in the
 * key and left out of the tooltip (legendMembership). Nothing when every
 * selected measure has an effect.
 *
 * @param {{members: Array<{id: string, name: string, muted: boolean}>, year: number}} props
 */
function ZeroMeasuresNote({ members, year }) {
  const zero = members.filter((member) => member.muted);
  if (!zero.length) return null;
  return (
    <Note>
      £0 for households in {fiscalYear(year)}, so greyed out in the key and
      left out of the tooltip:{" "}
      {zero.map((member, index) => (
        <span key={member.id} data-zero-measure={member.id}>
          {index > 0 && "; "}
          <strong>{member.name}</strong> ({zeroReason(member.id, year)})
        </span>
      ))}
      .
    </Note>
  );
}

export default ZeroMeasuresNote;
