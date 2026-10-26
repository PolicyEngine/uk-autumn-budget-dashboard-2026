/**
 * Headline figures: one card with the figures side by side, each a large
 * number and a short label below it, and an optional line (the source)
 * across the foot. Used by Young people and by the Living standards
 * forecast.
 *
 * items: [{ key, value, extra?, label, sub?, subClassName?, valueClassName? }].
 * `extra` sits after the number in smaller type; `sub` is a second, muted
 * line.
 */
function StatTiles({ items, footer, className = "" }) {
  return (
    <div className={`card stat-tiles ${className}`.trim()}>
      <div className="stat-tiles-row" style={{ "--stat-count": items.length }}>
        {items.map((item) => (
          <div key={item.key} className="stat-tile">
            <p className={`stat-value ${item.valueClassName ?? ""}`.trim()}>
              {item.value}
              {item.extra && <span className="stat-extra"> {item.extra}</span>}
            </p>
            <p className="stat-label">{item.label}</p>
            {item.sub && <p className={`stat-sub ${item.subClassName ?? ""}`.trim()}>{item.sub}</p>}
          </div>
        ))}
      </div>
      {footer && <div className="stat-tiles-footer">{footer}</div>}
    </div>
  );
}

export default StatTiles;
