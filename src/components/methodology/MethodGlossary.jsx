import { GLOSSARY, glossaryAnchor } from "./glossary";
import { SourceLink } from "./MethodUi";

/** A meaning with each of its `sources` phrases linked to the source. */
function linked(meaning, sources = {}) {
  const phrases = Object.keys(sources);
  if (!phrases.length) return meaning;
  const escaped = phrases.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return meaning
    .split(new RegExp(`(${escaped.join("|")})`))
    .map((part, index) =>
      sources[part] ? (
        <SourceLink key={index} id={sources[part]}>
          {part}
        </SourceLink>
      ) : (
        part
      ),
    );
}

/**
 * The terms the charts share, each defined here once (glossary.js) as a
 * term and one line; each term carries its own anchor, which a card's
 * "About this chart" links to.
 */
export default function MethodGlossary() {
  return (
    <dl className="method-glossary">
      {Object.entries(GLOSSARY).map(([key, { term, meaning, sources }]) => (
        <div key={key} id={glossaryAnchor(key)} className="method-glossary-row method-anchor">
          <dt>{term}</dt>
          <dd>{linked(meaning, sources)}</dd>
        </div>
      ))}
    </dl>
  );
}
