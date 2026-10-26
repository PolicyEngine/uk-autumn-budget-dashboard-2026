import LsCard from "./LsCard";
import PillSelect from "../PillSelect";
import ControlBar from "../ControlBar";

/**
 * A card that shows one of several views of a topic, chosen with a
 * "Show [ ▾ ]" pill, as Population impact's charts choose theirs. Each view (from a use…View hook) gives the card's parts: period,
 * summary, about, notes, source, download, its own pills and the chart.
 * The switch comes first in the one controls row, then the view's own
 * pills, then its other choices under Options. The row is one line high
 * whatever the view, so the card does not jump when the view changes.
 *
 * views: [{ value, label, view }], where a null view is left out.
 */
export default function ViewCard({ title, icon, name, views, value, onChange }) {
  const available = views.filter((v) => v.view);
  if (!available.length) return null;
  const current = available.find((v) => v.value === value) || available[0];
  const { view } = current;
  return (
    <LsCard
      title={title}
      icon={icon}
      period={view.period}
      summary={view.summary}
      about={view.about}
      notes={view.notes}
      source={view.source}
      sourceText={view.sourceText}
      download={view.download}
      controls={
        // One row: the Show pill and the view's own pills, then the view's
        // other choices under one Options button (ControlBar)
        <ControlBar name={title} options={view.controls?.options}>
          {available.length > 1 && (
            <PillSelect
              variant="light"
              prefix="Show"
              name={name}
              value={current.value}
              onChange={onChange}
              options={available.map((v) => ({ value: v.value, label: v.label }))}
              stableWidth
            />
          )}
          {view.controls?.primary}
        </ControlBar>
      }
    >
      {view.chart}
    </LsCard>
  );
}
