import LsCard from "./LsCard";
import ViewSwitch from "../ViewSwitch";

/**
 * A card that shows one of several views of a topic, chosen with a small
 * segmented switch (ViewSwitch, without icons; each view's short `badge`
 * as its label, the full label as its title). Each view (from a use…View hook) gives the card's parts: period,
 * summary, about, notes, source, download, its own pills and the chart.
 * The switch comes first in the one controls row, then the view's own
 * pills. A view with none keeps the first view's pills in place, hidden and
 * inert, so the card's layout does not jump when the view changes.
 *
 * views: [{ value, label, view }], where a null view is left out.
 */
export default function ViewCard({ title, name, views, value, onChange }) {
  const available = views.filter((v) => v.view);
  if (!available.length) return null;
  const current = available.find((v) => v.value === value) || available[0];
  const { view } = current;
  return (
    <LsCard
      title={title}
      period={view.period}
      summary={view.summary}
      about={view.about}
      notes={view.notes}
      source={view.source}
      sourceText={view.sourceText}
      download={view.download}
      controls={
        <>
          {available.length > 1 && (
            <ViewSwitch
              compact
              label={name}
              value={current.value}
              onChange={onChange}
              options={available.map((v) => ({ value: v.value, label: v.badge ?? v.label, title: v.label }))}
            />
          )}
          {view.controls ??
            (available[0].view.controls && (
              <span className="ls-controls-placeholder" aria-hidden="true" inert>
                {available[0].view.controls}
              </span>
            ))}
        </>
      }
    >
      {view.chart}
    </LsCard>
  );
}
