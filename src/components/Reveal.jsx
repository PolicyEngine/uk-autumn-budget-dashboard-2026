import { useRef } from "react";
import useScrollReveal from "../hooks/useScrollReveal";

/**
 * A block whose matching children (REVEAL_SELECTOR) reveal on scroll, for
 * views that do not sit inside the main page root (e.g. Methodology, once
 * #127 is in).
 */
export default function Reveal({ children, className }) {
  const ref = useRef(null);
  useScrollReveal(ref);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
