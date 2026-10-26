import { BookOpen, Calculator, Eye, Link2, TriangleAlert } from "lucide-react";
import { GLOSSARY, glossaryAnchor } from "./methodology/glossary";
import { MethodLink } from "../utils/methodLink";
import "./InfoSections.css";

/**
 * What a card's "About this chart" holds, in one fixed order. Each part is
 * shown only when it has content.
 *
 * @typedef {Object} ChartInfo
 * @property {import("react").ReactNode} [shows] - What it shows: one or two sentences
 * @property {import("react").ReactNode[]} [how] - How it's calculated: one bullet per step
 * @property {Array<{term: string, meaning: import("react").ReactNode} | {ref: keyof typeof GLOSSARY}>} [definitions]
 *   - A term only this card uses, with its meaning; or `{ ref }`, a term the
 *   charts share, defined once in Methodology and linked from here
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
    shows: info.shows || null,
    how: clean(info.how),
    own: definitions.filter((d) => !d.ref),
    shared: definitions.filter((d) => d.ref && GLOSSARY[d.ref]),
    caveats: clean(info.caveats),
    sources: clean(info.sources),
    method: info.method || null,
  };
}

export const hasInfo = (info) => {
  const p = infoParts(info);
  return Boolean(p.shows || p.how.length || p.own.length || p.shared.length || p.caveats.length || p.sources.length);
};

/** The closed disclosure's one line: what is inside, in order ("How it's calculated · Definitions · Source"). */
export function infoPreview(info) {
  const p = infoParts(info);
  const parts = [
    p.how.length > 0 && "How it's calculated",
    (p.own.length > 0 || p.shared.length > 0) && "Definitions",
    p.sources.length > 0 && (p.sources.length > 1 ? "Sources" : "Source"),
  ].filter(Boolean);
  if (!parts.length && p.shows) parts.push("What it shows");
  return parts.join(" · ");
}

/** "1 caveat", "3 caveats", or nothing. */
export function caveatChip(info) {
  const n = infoParts(info).caveats.length;
  if (!n) return null;
  return `${n} ${n === 1 ? "caveat" : "caveats"}`;
}

function Section({ icon: Icon, title, tone, children }) {
  return (
    <section className={`info-section${tone ? ` info-section-${tone}` : ""}`}>
      <h4 className="info-heading">
        <Icon aria-hidden="true" strokeWidth={1.75} />
        {title}
      </h4>
      <div className="info-body">{children}</div>
    </section>
  );
}

const Bullets = ({ items, className = "" }) => (
  <ul className={`info-list ${className}`.trim()}>
    {items.map((item, index) => (
      <li key={typeof item === "string" ? item : index}>{item}</li>
    ))}
  </ul>
);

/**
 * The open "About this chart": What it shows, How it's calculated,
 * Definitions, Caveats and Source, each with its icon and heading, in that
 * order, and only those with content.
 *
 * @param {{info: ChartInfo}} props
 */
export default function InfoSections({ info }) {
  const p = infoParts(info);
  return (
    <div className="info-sections">
      {p.shows && (
        <Section icon={Eye} title="What it shows">
          <Bullets items={[p.shows]} />
        </Section>
      )}
      {p.how.length > 0 && (
        <Section icon={Calculator} title="How it's calculated">
          <Bullets items={p.how} />
        </Section>
      )}
      {(p.own.length > 0 || p.shared.length > 0) && (
        <Section icon={BookOpen} title="Definitions">
          {p.own.length > 0 && (
            <dl className="info-terms">
              {p.own.map(({ term, meaning }) => (
                <div key={term} className="info-term">
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          {p.shared.length > 0 && (
            <p className="info-shared">
              <span className="info-shared-label">In Methodology:</span>{" "}
              {p.shared.map(({ ref }, index) => (
                <span key={ref}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  <MethodLink anchor={glossaryAnchor(ref)}>{GLOSSARY[ref].term}</MethodLink>
                </span>
              ))}
            </p>
          )}
        </Section>
      )}
      {p.caveats.length > 0 && (
        <Section icon={TriangleAlert} title="Caveats" tone="caveat">
          <Bullets items={p.caveats} className="info-caveats" />
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
      {p.method && (
        <p className="info-method">
          <MethodLink anchor={p.method.anchor}>
            {p.method.label} <span aria-hidden="true">→</span>
          </MethodLink>
        </p>
      )}
    </div>
  );
}

/** The source of every figure the page models itself. */
export const PE_MODEL_SOURCE = {
  label: "PolicyEngine UK on the Family Resources Survey 2024-25",
  href: "https://github.com/PolicyEngine/policyengine-uk",
};
