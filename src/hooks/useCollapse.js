import { useEffect, useState } from "react";

// How long an expander takes to open or close (the CSS transition on
// .expander-body matches it; not ".collapse", which Tailwind makes visibility: collapse)
export const COLLAPSE_MS = 220;

/**
 * An expander's content, opened and closed with a height transition: the
 * content mounts on opening and grows from nothing; on closing it shrinks,
 * then unmounts, so its fields are neither in the page nor in the Tab
 * order while closed. With prefers-reduced-motion the CSS turns the
 * transition off.
 *
 * @param {boolean} open
 * @returns {{ mounted: boolean, expanded: boolean }} - Render the content
 *   while `mounted`, inside `.expander-body` with `is-expanded` while `expanded`
 */
export default function useCollapse(open) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  // Opening mounts at once, so the content is there the moment it is asked for
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      // Grow on the frame after mounting, so the transition has a start
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the closing transition
    setExpanded(false);
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  return { mounted: mounted || open, expanded: expanded && open };
}
