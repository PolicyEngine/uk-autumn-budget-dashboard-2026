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
 * views: [{ value, label, view }], where a null view is left out.
 */
export default function ViewCard({ id, title, subtitle, icon, views, value, onChange, moreNotes = [] }) {
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
      source={view.source}
      sourceText={view.sourceText}
      download={view.download}
      controls={
        // One Options pill (ControlBar): the view first ("Show"), then the
        // view's own choices; a view's primary control, if any, beside it
        <ControlBar
          name={title}
          face={view.controls?.face}
          options={[
            // The years compared lead, then the view, then its other choices
            ...(view.controls?.options ?? []).filter((group) => group?.control),
            available.length > 1 && {
              label: "Show",
              value: current.value,
              onChange,
              options: available.map((v) => ({ value: v.value, label: v.label })),
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
