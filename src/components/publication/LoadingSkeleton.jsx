import "./publication.css";

/**
 * Grey placeholder cards in the shape of a view's charts, shown at once
 * while its verified figures load. Never a number, and never the
 * "not published yet" notice: that is only for an empty publication.
 */
export function SkeletonCard({ height = 260, label = null }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton-line is-title" />
      <span className="skeleton-line is-subtitle" />
      <span className="skeleton-plot" style={{ height }} />
      {label}
    </div>
  );
}

/** A view's placeholder: `cards` chart cards, announced once as loading. */
export default function LoadingSkeleton({ cards = 2, height = 260, label = "Loading published measures…" }) {
  return (
    <div className="skeleton-view" role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-grid">
        {Array.from({ length: cards }, (_, index) => <SkeletonCard key={index} height={height} />)}
      </div>
    </div>
  );
}

/**
 * A placeholder for one chart or map while its data loads: a shimmering
 * block of the plot's size, announced once by `label`.
 */
export function PlotSkeleton({ label, height = 320, className = "" }) {
  return (
    <div className={`skeleton-plot-block ${className}`.trim()} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <span className="skeleton-plot" style={{ height }} aria-hidden="true" />
    </div>
  );
}
