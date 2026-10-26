import { useEffect, useState } from "react";
import { MOTION_FAST_MS, prefersReducedMotion } from "../utils/chartMotion";

/**
 * A popover or menu that fades and scales in when opened and fades out
 * when closed: it mounts at once on opening, and on closing stays mounted
 * (marked leaving: no pointer, hidden from assistive technology) for
 * `ms`, then unmounts. With prefers-reduced-motion it unmounts at once.
 * Timed with setTimeout, not animationend, which a 0ms animation never
 * fires. Render while `mounted`; add `popoverClass(shown)` to its root.
 *
 * @param {boolean} open
 * @param {number} [ms]
 * @returns {{ mounted: boolean, shown: boolean }}
 */
export default function usePresence(open, ms = MOTION_FAST_MS) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return undefined;
    if (prefersReducedMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- unmount the closed popover at once
      setMounted(false);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, mounted, ms]);

  return { mounted: open || mounted, shown: open };
}

/** The classes for a popover's root: in while shown, out while leaving. */
export function popoverClass(shown) {
  return shown ? "popover-motion" : "popover-motion is-leaving";
}

/** Props for a leaving popover's root: out of reach while it fades. */
export function leavingProps(shown) {
  return shown ? {} : { "aria-hidden": "true", inert: true };
}
