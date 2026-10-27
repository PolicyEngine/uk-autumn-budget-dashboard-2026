import { useEffect, useState } from "react";
import { openDisclosuresAround } from "../Disclosure";
import { COLLAPSE_MS } from "../../hooks/useCollapse";

// Where a section counts as current: its top has passed this far below the
// sticky band and tabs (their heights are CSS variables), as the reader
// scrolls.
const CURRENT_LINE_EXTRA = 32;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scroll a section into view, keep its anchor in the address, and move focus to its title. */
export function goToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#${id}`);
  const title = target.querySelector("h2");
  if (title) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
}

/**
 * Bring an anchor in this view into sight: open the "More info" it is
 * folded in, then, once it is laid out, scroll to it.
 */
export function revealAnchor(id, { smooth = true } = {}) {
  const target = document.getElementById(id);
  if (!target) return false;
  openDisclosuresAround(target);
  const scroll = () =>
    target.scrollIntoView?.({ behavior: smooth && !reducedMotion() ? "smooth" : "auto", block: "start" });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(scroll));
  else scroll();
  // Once the topic has opened and the page has settled, line it up again
  setTimeout(() => target.scrollIntoView?.({ behavior: "auto", block: "start" }), COLLAPSE_MS + 120);
  return true;
}

/** The section whose top has most recently passed the line under the sticky band. */
function currentSection(sections) {
  const root = document.querySelector(".app") ?? document.documentElement;
  const style = getComputedStyle(root);
  const px = (name) => parseFloat(style.getPropertyValue(name)) || 0;
  const offset = px("--title-row-height") + px("--view-tabs-height");
  const line = offset + CURRENT_LINE_EXTRA;
  let current = sections[0]?.id;
  for (const { id } of sections) {
    const element = document.getElementById(id);
    if (element && element.getBoundingClientRect().top <= line) current = id;
  }
  // At the foot of the page the last section is current, however short
  const { scrollHeight } = document.documentElement;
  const atEnd =
    scrollHeight > window.innerHeight &&
    window.innerHeight + window.scrollY >= scrollHeight - 2;
  return atEnd ? sections[sections.length - 1]?.id : current;
}

/**
 * The Methodology view's contents: a sticky list of its sections on a wide
 * screen, with the section being read highlighted, and a jump menu on a
 * phone. One nav landmark holds both; CSS shows one of them.
 *
 * @param {Object} props
 * @param {Array<{id: string, title: string, icon?: import("react").ComponentType}>} props.sections
 */
function MethodContents({ sections }) {
  const [current, setCurrent] = useState(sections[0]?.id);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrent(currentSection(sections)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  return (
    <nav className="method-contents" aria-label="Methodology contents">
      <p className="method-contents-title" aria-hidden="true">
        On this page
      </p>
      <ol className="method-contents-list">
        {sections.map(({ id, title, icon: Icon }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={current === id ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setCurrent(id);
                goToSection(id);
              }}
            >
              {Icon && <Icon className="method-contents-icon" aria-hidden="true" strokeWidth={1.75} />}
              <span>{title}</span>
            </a>
          </li>
        ))}
      </ol>
      <label className="method-jump">
        <span className="method-jump-label">Jump to</span>
        <select
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            goToSection(event.target.value);
          }}
        >
          {sections.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

export default MethodContents;
