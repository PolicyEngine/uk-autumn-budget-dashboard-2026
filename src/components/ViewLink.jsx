import { openDisclosuresAround } from "./Disclosure";

/**
 * A link to another view at one of its sub-tabs, switched to in place
 * (App.jsx handleTabChange), scrolling to `hash` once it is shown. The href
 * is the same address, so it also works opened in a new tab. A target
 * folded in a closed disclosure is opened first.
 */
export default function ViewLink({ tab, sub, age, hash, onShowTab, children }) {
  return (
    <a
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}${age ? `&age=${age}` : ""}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        if (!onShowTab) return;
        event.preventDefault();
        onShowTab(tab, sub, age ? { age } : undefined);
        if (hash) {
          setTimeout(() => {
            const target = document.getElementById(hash);
            if (!target) return;
            openDisclosuresAround(target);
            requestAnimationFrame(() =>
              requestAnimationFrame(() => target.scrollIntoView?.({ behavior: "smooth", block: "start" })),
            );
          }, 50);
        }
      }}
    >
      {children}
    </a>
  );
}
