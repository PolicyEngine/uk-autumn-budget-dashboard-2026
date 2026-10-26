// Small presentational pieces of the Methodology view: an icon in a tinted
// chip, a tag (a pill, optionally a link), a callout and a back-to-top link.

import { ArrowUp, CircleSlash } from "lucide-react";
import { goToSection, OPEN_SECTION_EVENT } from "./MethodContents";
import { EXTERNAL, SOURCES } from "../../utils/sources";

/** An icon in a tinted square chip; decorative, so hidden from assistive tech. */
export function IconChip({ icon: Icon, size = "md", tone = "teal" }) {
  if (!Icon) return null;
  return (
    <span className={`method-icon method-icon-${size} method-icon-${tone}`} aria-hidden="true">
      <Icon strokeWidth={1.75} />
    </span>
  );
}

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

/** A note set off from the text, with an information or warning icon. */
export function Callout({ icon: Icon, tone = "info", title, children }) {
  return (
    <div className={`method-callout method-callout-${tone}`}>
      {Icon && (
        <span className="method-callout-icon" aria-hidden="true">
          <Icon strokeWidth={1.75} />
        </span>
      )}
      <div className="method-callout-body">
        <h3 className="method-callout-title">{title}</h3>
        <div className="method-callout-text">{children}</div>
      </div>
    </div>
  );
}

/** A link back to the contents at the top of the view. */
export function BackToTop({ targetId }) {
  return (
    <p className="method-back">
      <a
        href={`#${targetId}`}
        onClick={(event) => {
          event.preventDefault();
          goToSection(targetId);
        }}
      >
        <ArrowUp aria-hidden="true" strokeWidth={1.75} />
        Back to top
      </a>
    </p>
  );
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
 * A link to an anchor in this view: a section, a heading inside a folded
 * "Technical details" (opened first) or a term.
 */
export function AnchorLink({ id, children }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        const target = document.getElementById(id);
        if (!target) return;
        const folded = target.closest("details");
        if (folded) folded.open = true;
        window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: target.closest("section")?.id ?? id }));
        target.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
