// Projection caveats and known baseline gaps (meta.caveats), as a visible
// list: several change how the charts above read. Ported from
// PolicyEngine/uk-living-standards-outlook; wording unchanged.

import { fyDash } from "../../../utils/livingStandards/outlook";
import { plainWords } from "../sources";

export default function CaveatsSection({ data }) {
  const caveats = data.meta?.caveats || [];
  if (!caveats.length) return null;
  return (
    <div className="card ls-caveats">
      <ul>
        {caveats.map((c) => (
          <li key={c}>{fyDash(plainWords(c))}</li>
        ))}
      </ul>
    </div>
  );
}
