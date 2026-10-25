import { EXTERNAL, SOURCES } from "../utils/sources";

/**
 * A named source as a link to its page (src/utils/sources.js), opened in a
 * new tab; plain text while the page does not exist yet. `children`
 * replaces the source's own label as the anchor text.
 */
export default function SourceLink({ source, children }) {
  const entry = SOURCES[source];
  if (!entry) throw new Error(`Unknown source: ${source}`);
  const text = children ?? entry.label;
  if (!entry.url) return <>{text}</>;
  return (
    <a href={entry.url} {...EXTERNAL}>
      {text}
    </a>
  );
}
