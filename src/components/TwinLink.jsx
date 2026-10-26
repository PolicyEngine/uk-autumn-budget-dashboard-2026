/**
 * The link from a sub-tab to its twin in the other view: Population
 * impact's Living standards and Poverty (with the selected measures) and
 * the Pre-measures forecast's sub-tabs of the same names (without the
 * measures). A real link, so it opens in a new tab too; a plain click
 * switches the view in place.
 *
 * @param {Object} props
 * @param {string} props.tab - The view to open ("dashboard" or "outlook")
 * @param {string} props.sub - Its sub-tab, which has the same name in both views
 * @param {(tab: string, sub: string) => void} [props.onShow] - Switch to that view at that sub-tab
 * @param {string} [props.label] - The link's words, in place of "See this with(out) the measures"
 * @param {string} [props.anchor] - An element id in the twin to bring into view (one card's twin)
 */
export default function TwinLink({ tab, sub, onShow, label: text, anchor }) {
  const label = text ?? (tab === "outlook" ? "See this without the measures" : "See this with the measures");
  return (
    <a
      className="twin-link"
      href={`?tab=${tab}&sub=${sub}`}
      onClick={(event) => {
        if (!onShow) return;
        event.preventDefault();
        onShow(tab, sub);
        // The twin card, once the view has switched and laid out
        if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 250);
      }}
    >
      {label} →
    </a>
  );
}
