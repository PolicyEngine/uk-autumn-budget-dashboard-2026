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

/** A policy's card on the Policies tab (PolicyCards.jsx gives each card this id). */
export const policyCardAnchor = (id) => `policy-${id}`;
export const policyCardHref = (id) => `?tab=policies#${policyCardAnchor(id)}`;

export function openPolicyCard(id) {
  window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: { tab: "policies", anchor: policyCardAnchor(id) } }));
}

/** A policy's name as a link to its card on the Policies tab, switched to in place. */
export function PolicyLink({ id, children }) {
  return (
    <a
      className="method-link"
      href={policyCardHref(id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        openPolicyCard(id);
      }}
    >
      {children}
    </a>
  );
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
