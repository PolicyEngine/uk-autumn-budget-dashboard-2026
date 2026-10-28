/**
 * Where a hover tooltip goes so it stays wholly inside the window: beside
 * its anchor (the cursor, or the hovered point), right of it and below by
 * default, flipped left near the right edge and above near the foot, and
 * never under the sticky title band and tab rows (topInset) or within
 * `margin` px of an edge. A tooltip taller than the room left gets a
 * maxHeight (it scrolls inside); one wider gets a maxWidth.
 *
 * Pure, so the flips and clamps are unit tested (tooltipPlacement.test.js).
 */
export const TOOLTIP_MARGIN = 8;

/**
 * @param {Object} args
 * @param {number} args.x - Anchor, in window (client) px
 * @param {number} args.y
 * @param {number} args.width - The tooltip's measured size
 * @param {number} args.height
 * @param {number} args.viewportWidth
 * @param {number} args.viewportHeight
 * @param {number} [args.topInset] - What the sticky band covers at the top
 * @param {number} [args.offset] - Gap from the anchor (0 for a pinned box,
 *   whose top-left corner is the anchor)
 * @param {number} [args.margin]
 * @returns {{left: number, top: number, maxHeight: number|null, maxWidth: number|null, flippedX: boolean, flippedY: boolean}}
 */
export function placeTooltip({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  topInset = 0,
  offset = 12,
  margin = TOOLTIP_MARGIN,
}) {
  const minLeft = margin;
  const maxRight = viewportWidth - margin;
  const minTop = Math.max(0, topInset) + margin;
  const maxBottom = viewportHeight - margin;
  const roomX = Math.max(0, maxRight - minLeft);
  const roomY = Math.max(0, maxBottom - minTop);
  const w = Math.min(width, roomX);
  const h = Math.min(height, roomY);

  // Across: right of the anchor, else left of it, else the side with more room
  let left = x + offset;
  let flippedX = false;
  if (left + w > maxRight) {
    const leftSide = x - offset - w;
    if (leftSide >= minLeft || x - minLeft > maxRight - x) {
      left = leftSide;
      flippedX = true;
    }
  }
  left = Math.min(Math.max(left, minLeft), maxRight - w);

  // Down: below the anchor, else above it, else as low as fits (the
  // tooltip is beside the anchor, so overlapping its height is fine)
  let top = y + offset;
  let flippedY = false;
  if (top + h > maxBottom) {
    const above = y - offset - h;
    if (above >= minTop) {
      top = above;
      flippedY = true;
    }
  }
  top = Math.min(Math.max(top, minTop), maxBottom - h);

  return {
    left,
    top,
    maxHeight: height > roomY ? roomY : null,
    maxWidth: width > roomX ? roomX : null,
    flippedX,
    flippedY,
  };
}

/**
 * The height the sticky title band and tab rows cover (--sticky-offset, set
 * on .app), read by a probe placed inside `node` so the view's own value
 * counts. 0 outside the dashboard.
 */
export function stickyInset(node) {
  if (!node || typeof document === "undefined") return 0;
  const host = node.closest?.(".app") ?? node.parentElement ?? document.body;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(--sticky-offset, 0px)";
  host.appendChild(probe);
  const height = probe.offsetHeight || 0;
  probe.remove();
  return height;
}
