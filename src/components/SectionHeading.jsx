import { useEffect, useRef, useState } from "react";
import TitleIcon from "./TitleIcon";
import Tip from "./Tip";

/** "Who gains and from what" -> "who-gains-and-from-what" */
export const sectionSlug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// One scroll to the linked section per page load, whichever heading it is
let hashHandled = false;

/**
 * A section's title and one-line subtitle, on the page above its cards: an
 * icon in a tinted circle, the title and a "#" that copies a link to the
 * section. The id is the title's
 * slug unless given; pass one where a title repeats on another sub-tab.
 */
function SectionHeading({ title, subtitle, id, icon, className = "" }) {
  const anchor = id ?? (typeof title === "string" ? sectionSlug(title) : undefined);
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);

  // Opened from a link to this section: bring it into view once laid out
  useEffect(() => {
    if (hashHandled || !anchor || typeof window === "undefined") return undefined;
    if (window.location.hash !== `#${anchor}`) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element || element.offsetParent === null) return;
      hashHandled = true;
      element.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = (event) => {
    event.preventDefault();
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${anchor}`;
    window.history.replaceState(window.history.state, "", url);
    ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <div
      ref={ref}
      id={anchor}
      className={`section-heading ${icon ? "has-icon" : ""} ${className}`.replace(/\s+/g, " ").trim()}
    >
      {icon && (
        <span className="section-icon" aria-hidden="true">
          <TitleIcon name={icon} bare size={18} />
        </span>
      )}
      <div className="section-heading-text">
        <div className="section-heading-title">
          <h2>{title}</h2>
          {anchor && (
            <Tip content={copied ? "Link copied" : "Copy a link to this section"}>
            <a
              className={`section-anchor ${copied ? "is-copied" : ""}`.trim()}
              href={`#${anchor}`}
              onClick={copyLink}
              aria-label={copied ? "Link copied" : `Copy a link to “${title}”`}
            >
              {/* "#" or "Copied" is drawn by CSS, so the heading's text stays
                  its title and subtitle */}
            </a>
            </Tip>
          )}
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

export default SectionHeading;
