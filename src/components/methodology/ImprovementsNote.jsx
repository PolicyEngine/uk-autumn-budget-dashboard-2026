import { IMPROVEMENTS_NOTE } from "./improvementsText";

/**
 * "What we're improving" (improvementsText.js), open, as its own card
 * above the Limitations topics: a title, then each part's lead line and
 * its list.
 */
export default function ImprovementsNote({ note = IMPROVEMENTS_NOTE }) {
  const headingId = `${note.id}-heading`;
  return (
    <section id={note.id} className="method-anchor method-note" aria-labelledby={headingId}>
      <h3 id={headingId} className="method-note-title">
        {note.title}
      </h3>
      {note.parts.map(({ lead, items }) => (
        <div key={lead} className="method-note-part">
          <p className="method-lead">{lead}</p>
          <ul className="method-list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
