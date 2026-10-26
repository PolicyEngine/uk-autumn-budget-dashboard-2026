import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../utils/chartMotion";

// The dashboard's number animation (.claude/CLAUDE.md): ease-out cubic, at
// most 400ms when a figure updates, so it is perceptible but quick
export const COUNT_UP_MS = 400;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * A number that counts from its last value to `target` over `duration`
 * (COUNT_UP_MS), eased out, one requestAnimationFrame at a time. The first
 * value is shown as it is (no count on page load), unless `fromZero` (a
 * result that arrives after the reader asked for it). With
 * prefers-reduced-motion, or no target, it is `target` at once.
 *
 * @param {number|null} target
 * @param {{ duration?: number, fromZero?: boolean }} [options]
 * @returns {number|null}
 */
export default function useCountUp(target, { duration = COUNT_UP_MS, fromZero = false } = {}) {
  const [value, setValue] = useState(target === null || !fromZero || prefersReducedMotion() ? target : 0);
  const from = useRef(value ?? 0);

  useEffect(() => {
    if (target === null || target === undefined) return undefined;
    if (prefersReducedMotion()) {
      from.current = target;
      setValue(target);
      return undefined;
    }
    const start = from.current;
    let begun = null;
    let frame = requestAnimationFrame(function step(now) {
      if (begun === null) begun = now;
      const t = Math.min(1, (now - begun) / duration);
      const next = start + (target - start) * easeOutCubic(t);
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return target === null || target === undefined ? target : value;
}
