import { BookOpen, Calculator, Eye, History, Link2, TriangleAlert } from "lucide-react";
import { GLOSSARY, glossaryAnchor } from "./methodology/glossary";
import { MethodLink } from "../utils/methodLink";
import "./InfoSections.css";

/**
 * What a card's "About this chart" holds, in one fixed order. Each part is
 * shown only when it has content.
 *
 * @typedef {Object} ChartInfo
 * @property {{title: string, body: import("react").ReactNode}} [lead] - A short
 *   item of its own, first: e.g. "Before the years shown", one sentence
 * @property {import("react").ReactNode} [shows] - What it shows: one or two sentences
 * @property {import("react").ReactNode[]} [how] - How it's calculated: one bullet per step
 * @property {Array<{term: string, meaning: import("react").ReactNode} | {ref: keyof typeof GLOSSARY}>} [definitions]
 *   - A term only this card uses, with its meaning; or `{ ref }`, a term the
 *   charts share, defined once in Methodology and linked from here
 * @property {string} [definitionsTitle] - The Definitions heading, when a card's terms want their own name
 * @property {import("react").ReactNode[]} [caveats] - Caveats: one bullet each
 * @property {Array<{label: string, href?: string, date?: string, note?: string}>} [sources]
 * @property {{anchor: string, label: string}} [method] - The relevant Methodology
 *   section, where the deeper detail lives: the disclosure ends with a link to it
 */

const clean = (items) => (items || []).filter((item) => item !== null && item !== undefined && item !== false && item !== "");

/** The parts of an info object that have content. */
export function infoParts(info = {}) {
  const definitions = clean(info.definitions);
  return {
    lead: info.lead && info.lead.body ? info.lead : null,
    shows: info.shows || null,
    how: clean(info.how),
    own: definitions.filter((d) => !d.ref),
    shared: definitions.filter((d) => d.ref && GLOSSARY[d.ref]),
    definitionsTitle: info.definitionsTitle || "Definitions",
    caveats: clean(info.caveats),
    sources: clean(info.sources),
    method: info.method || null,
  };
}

export const hasInfo = (info) => {
  const p = infoParts(info);
  return Boolean(p.lead || p.shows || p.how.length || p.own.length || p.shared.length || p.caveats.length || p.sources.length || p.method);
};

/** The closed disclosure's one line: the sections inside, in order ("What it shows · Caveats · Source"). */
export function infoPreview(info) {
  const p = infoParts(info);
  const parts = [
    p.lead && p.lead.title,
    p.shows && "What it shows",
    p.how.length > 0 && "How it's calculated",
    p.own.length > 0 && p.definitionsTitle,
    p.caveats.length > 0 && "Caveats",
    p.sources.length > 0 && (p.sources.length > 1 ? "Sources" : "Source"),
  ].filter(Boolean);
  if (!parts.length && p.method) parts.push(p.method.label);
  return parts.join(" · ");
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="info-section">
      <h4 className="info-heading">
        <Icon aria-hidden="true" strokeWidth={1.75} />
        {title}
      </h4>
      <div className="info-body">{children}</div>
    </section>
  );
}

/** Bullets only for two or more items; one item is a plain line. */
const Items = ({ items, className = "" }) =>
  items.length > 1 ? (
    <ul className={`info-list ${className}`.trim()}>
      {items.map((item, index) => (
        <li key={typeof item === "string" ? item : index}>{item}</li>
      ))}
    </ul>
  ) : (
    <div className={`info-text ${className}`.trim()}>{items[0]}</div>
  );

/**
 * The open "About this chart": What it shows, How it's calculated,
 * Definitions, Caveats and Source, each with its icon and heading, in that
 * order, and only those with content. Every section looks the same (Caveats
 * too, bar its icon); bullets only where a section has two or more items;
 * definitions as the term in semibold over its meaning. The Methodology links (the card's
 * section and its shared terms) close it as one "More in Methodology" line.
 *
 * @param {{info: ChartInfo}} props
 */
export default function InfoSections({ info }) {
  const p = infoParts(info);
  return (
    <div className="info-sections">
      {p.lead && (
        <Section icon={History} title={p.lead.title}>
          <Items items={[p.lead.body]} className="info-lead" />
        </Section>
      )}
      {p.shows && (
        <Section icon={Eye} title="What it shows">
          <Items items={[p.shows]} />
        </Section>
      )}
      {p.how.length > 0 && (
        <Section icon={Calculator} title="How it's calculated">
          <Items items={p.how} />
        </Section>
      )}
      {p.own.length > 0 && (
        <Section icon={BookOpen} title={p.definitionsTitle}>
          <dl className="info-terms">
            {p.own.map(({ term, meaning }) => (
              <div key={term} className="info-term">
                <dt>{term}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      {p.caveats.length > 0 && (
        <Section icon={TriangleAlert} title="Caveats">
          <Items items={p.caveats} className="info-caveats" />
        </Section>
      )}
      {p.sources.length > 0 && (
        <Section icon={Link2} title={p.sources.length > 1 ? "Sources" : "Source"}>
          <ul className="info-list info-sources">
            {p.sources.map(({ label, href, date, note }) => (
              <li key={label}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                ) : (
                  label
                )}
                {date && <span className="info-date"> ({date})</span>}
                {note && <span className="info-source-note">: {note}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(p.method || p.shared.length > 0) && (
        <p className="info-method">
          <span className="info-method-label">More in Methodology:</span>{" "}
          {[
            ...(p.method ? [{ key: "method", anchor: p.method.anchor, label: p.method.label }] : []),
            ...p.shared.map(({ ref }) => ({ key: ref, anchor: glossaryAnchor(ref), label: GLOSSARY[ref].term })),
          ].map(({ key, anchor, label }, index) => (
            <span key={key}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <MethodLink anchor={anchor}>{label}</MethodLink>
            </span>
          ))}{" "}
          <span aria-hidden="true">→</span>
        </p>
      )}
    </div>
  );
}
