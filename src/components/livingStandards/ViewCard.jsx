import LsCard from "./LsCard";
import PillSelect from "../PillSelect";

/**
 * A card that shows one of several views of a topic, chosen with a "Show"
 * pill. Each view (from a use…View hook) gives the card's parts: period,
 * summary, about, notes, source, download, its own pills and the chart.
 * The Show pill comes first in the one controls row, then the view's own
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
          <PillSelect
            variant="light"
            prefix="Show"
            name={name}
            value={current.value}
            onChange={onChange}
            options={available.map((v) => ({ value: v.value, label: v.label, badge: v.badge }))}
          />
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
