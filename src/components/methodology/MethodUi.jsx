// Small presentational pieces of the Methodology view:
// a tag (a pill, optionally a link), links and a folded topic.

import { CircleSlash } from "lucide-react";
import Disclosure from "../Disclosure";
import { revealAnchor } from "./MethodContents";
import { EXTERNAL, SOURCES } from "../../utils/sources";

/**
 * A small pill. With `onClick` it is a button that goes somewhere (another
 * view or section); otherwise a plain label.
 */
export function Tag({ children, tone = "neutral", onClick, href }) {
  const className = `method-tag method-tag-${tone}`;
  if (onClick) {
    return (
      <a
        className={`${className} method-tag-link`}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onClick();
        }}
      >
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

/** A link to another site, in a new tab, saying so to screen readers. */
export function ExternalLink({ href, children }) {
  return (
    <a href={href} {...EXTERNAL}>
      {children}
      <span className="policy-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A link to a named external source (src/utils/sources.js), in a new tab. */
export function SourceLink({ id, children }) {
  const source = SOURCES[id];
  return <ExternalLink href={source.url}>{children ?? source.label}</ExternalLink>;
}

/**
 * A link to an anchor in this view: a section, a topic folded in a "More
 * info" (opened first) or a term.
 */
export function AnchorLink({ id, children }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        if (!revealAnchor(id)) return;
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${id}`);
      }}
    >
      {children}
    </a>
  );
}

/** A compact list of measures and a reason each ("Unavailable", "Not modelled"). */
export function ReasonList({ items, icon = false }) {
  return (
    <ul className="mm-reasons">
      {items.map((item) => (
        <li key={item.name}>
          <span className="mm-reason-name">
            {icon && <CircleSlash className="method-row-icon" aria-hidden="true" strokeWidth={1.75} />}
            {item.name}
          </span>
          <span className="mm-reason-why">{item.why}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One folded topic of a section ("More info", "Household scatter"): the
 * shared Disclosure, closed until asked for, with a one-line preview of
 * what is inside. Its content stays in the page while closed, so a link
 * to an id inside it (a term, a heading) finds it and opens it.
 */
export function Topic({ id, title, preview, children }) {
  return (
    <Disclosure id={id} keepMounted title={title} preview={preview} className="method-topic method-anchor">
      {children}
    </Disclosure>
  );
}
