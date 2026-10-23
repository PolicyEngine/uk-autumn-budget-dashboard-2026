// "About this data": the dashboard's disclosure card, collapsed by default.
// Open, it shows the prices and sources and the notes as a short list;
// notes longer than NOTE_LIMIT are cut, with the full text in a nested
// "Technical notes" disclosure. Ported from
// PolicyEngine/uk-living-standards-outlook; notes unchanged. The model and
// data versions, and the demo status, are stated once in the tab's
// provenance line, so they are not repeated here.

import Disclosure from "../../Disclosure";
import { fyDash, splitSource } from "../../../utils/livingStandards/outlook";
import { HBAI_URL, OBR_EFO_TITLE, OBR_EFO_URL, plainWords } from "../sources";

const NOTE_LIMIT = 160;

// Notes said elsewhere on the page: the demo status (the provenance line)
// and the Budget forecast date (the Forecast changes subtitle).
const SAID_ELSEWHERE = [/unvalidated demo output/i, /OBR forecast is due on/i];

function shorten(note) {
  if (note.length <= NOTE_LIMIT) return note;
  const cut = note.slice(0, NOTE_LIMIT);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:(]+$/, "")}…`;
}

export default function AboutDataSection({ data }) {
  const meta = data.meta;
  if (!meta) return null;
  const hbai = splitSource(meta.outturn_source);
  const deflatorText = meta.deflator || "";
  const deflator = /consumer_price_index_ahc|CPI after housing costs/i.test(deflatorText)
    ? "OBR CPI (BHC), CPI after housing costs (AHC)"
    : /OBR CPI/i.test(deflatorText)
      ? "OBR CPI"
      : null;
  const notes = (meta.notes || []).filter((n) => !SAID_ELSEWHERE.some((re) => re.test(n)));
  const long = notes.filter((n) => n.length > NOTE_LIMIT);

  return (
    <section id="about-data" className="report-section">
      <Disclosure title="About this data" contentClassName="policy-details-content">
        <dl className="ls-meta-list">
          {meta.real_price_base && (
            <>
              <dt>Prices</dt>
              <dd>{[fyDash(meta.real_price_base), deflator].filter(Boolean).join(", ")}</dd>
            </>
          )}
          <dt>Sources</dt>
          <dd>
            DWP,{" "}
            <a href={hbai.url || HBAI_URL} target="_blank" rel="noopener noreferrer">
              Households Below Average Income
            </a>
            ; Office for Budget Responsibility,{" "}
            <a href={OBR_EFO_URL} target="_blank" rel="noopener noreferrer">
              {OBR_EFO_TITLE}
            </a>
          </dd>
        </dl>
        <ul className="ls-meta-notes">
          {notes.map((n) => (
            <li key={n}>{fyDash(plainWords(shorten(n)))}</li>
          ))}
        </ul>
        {long.length > 0 && (
          <details className="ls-technical-notes">
            <summary>Technical notes</summary>
            <ul className="ls-meta-notes">
              {long.map((n) => (
                <li key={n}>{fyDash(plainWords(n))}</li>
              ))}
            </ul>
          </details>
        )}
      </Disclosure>
    </section>
  );
}
