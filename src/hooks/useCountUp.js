import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../utils/chartMotion";

// The dashboard's number animation (.claude/CLAUDE.md): 800ms, ease-out cubic
export const COUNT_UP_MS = 800;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * A number that counts from its last value to `target` over 800ms, eased
 * out, one requestAnimationFrame at a time; the first value counts up from
 * zero. With prefers-reduced-motion, or no target, it is `target` at once.
 *
 * @param {number|null} target
 * @returns {number|null}
 */
export default function useCountUp(target) {
  const [value, setValue] = useState(target === null || prefersReducedMotion() ? target : 0);
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
      const t = Math.min(1, (now - begun) / COUNT_UP_MS);
      const next = start + (target - start) * easeOutCubic(t);
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return target === null || target === undefined ? target : value;
}
