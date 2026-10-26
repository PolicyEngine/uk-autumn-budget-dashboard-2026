/**
 * A link from a card's "About this chart" to the Methodology view, at one
 * of its terms or sections: a real link (?tab=methodology#id), so it opens
 * in a new tab too; a plain click switches the view in place (App listens
 * for OPEN_VIEW_EVENT) and brings the target into view.
 */
export const OPEN_VIEW_EVENT = "dashboard:open-view";

export const methodHref = (anchor) => `?tab=methodology${anchor ? `#${anchor}` : ""}`;

export function openMethodology(anchor) {
  window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: { tab: "methodology", anchor } }));
}

export function MethodLink({ anchor, children }) {
  return (
    <a
      className="method-link"
      href={methodHref(anchor)}
      onClick={(event) => {
        // Ctrl or Cmd click opens a new tab as usual
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        openMethodology(anchor);
      }}
    >
      {children}
    </a>
  );
}
