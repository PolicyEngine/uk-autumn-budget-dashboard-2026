import LsCard from "./LsCard";
import ControlBar from "../ControlBar";

/**
 * A card that shows one of several views of a topic. Each view (from a
 * use…View hook) gives the card's parts: period, summary, about, notes,
 * source, download, its choices and the chart. The card has one Options
 * pill (ControlBar) whose summary reads every choice ("Rate · Absolute ·
 * Before housing costs · …"): the view first, as "Show", then the view's
 * own. The row is one line high whatever the view, so the card does not
 * jump when the view changes.
 *
 * views: [{ value, label, description?, view }], where a null view is left
 * out; a description explains that view behind an ⓘ beside "Show".
 */
export default function ViewCard({ id, title, subtitle, icon, views, value, onChange, moreNotes = [], moreCaveats = [] }) {
  const available = views.filter((v) => v.view);
  if (!available.length) return null;
  const current = available.find((v) => v.value === value) || available[0];
  const { view } = current;
  return (
    <LsCard
      id={id}
      title={title}
      subtitle={subtitle}
      icon={icon}
      period={view.period}
      summary={view.summary}
      about={view.about}
      notes={[...(view.notes || []), ...moreNotes]}
      // A link to the card's twin (moreNotes) closes How it's calculated
      info={
        view.info && {
          ...view.info,
          how: [...(view.info.how || []), ...moreNotes],
          caveats: [...moreCaveats, ...(view.info.caveats || [])],
        }
      }
      source={view.source}
      sourceText={view.sourceText}
      download={view.download}
      controls={
        // One Options pill (ControlBar): the view first ("Show"), then the
        // view's own choices; a view's primary control, if any, beside it
        <ControlBar
          name={title}
          options={[
            // The years compared lead, then the view, then its other choices
            ...(view.controls?.options ?? []).filter((group) => group?.control),
            available.length > 1 && {
              label: "Show",
              value: current.value,
              onChange,
              // A view's description, if any, is behind the ⓘ beside "Show"
              options: available.map((v) => ({ value: v.value, label: v.label, description: v.description })),
            },
            ...(view.controls?.options ?? []).filter((group) => group && !group.control),
          ]}
        >
          {view.controls?.primary}
        </ControlBar>
      }
    >
      {view.chart}
    </LsCard>
  );
}
