import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { POLICY_COLORS, REVENUE_RAISING_NAMES, shortName } from "../utils/policyConfig";
import { POLICIES } from "../utils/policies";
import { MUTED_SWATCH } from "../utils/legendMembership";
import "./MeasureKey.css";

/**
 * The measure key: one compact row of chips for the measures a chart (or a
 * section of charts) colours by, in place of a long legend per card.
 *
 * - Each chip is a measure's colour and short name (its full name in the
 *   tooltip and accessible name), grouped "Raises revenue" then "Costs
 *   revenue", then the net line.
 * - Measures with no effect in the year shown (`muted`, legendMembership)
 *   are folded into one "+N with no effect" chip that opens them; they stay
 *   in the key, so no measure silently disappears. Why each is £0 stays in
 *   the card's More info.
 * - Hovering or focusing a chip highlights that measure in every chart that
 *   reads the same key (the others fade); a click keeps it highlighted until
 *   it is clicked again.
 *
 * A section shares one key: wrap its cards in <MeasureKeyProvider> and put
 * <SectionMeasureKey /> above them. Each card calls useMeasureKey(members):
 * inside a provider it registers its measures with the section's key and
 * draws none of its own; on its own it draws the key in its legend row.
 */

const KeyContext = createContext(null);

/** The opacity of a measure's bars while `highlight` is set. */
export const FADED_OPACITY = 0.18;

/** Fill opacity for a measure's series given the highlighted measure name. */
export function measureOpacity(highlight, name) {
  return highlight && highlight !== name ? FADED_OPACITY : 1;
}

/** Members from several cards as one list: a measure is muted only when it
 * is muted in every card that lists it; the order is the first card's. */
export function mergeMembers(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const member of list) {
      const seen = byId.get(member.id);
      if (!seen) byId.set(member.id, { ...member });
      else if (!member.muted) seen.muted = false;
    }
  }
  // Keep the legends' order (every list is in it already)
  const order = POLICIES.map((policy) => policy.id);
  return [...byId.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** A section's shared key and highlight. */
export function MeasureKeyProvider({ children }) {
  const [entries, setEntries] = useState({});
  const [highlight, setHighlight] = useState(null);
  const register = useCallback((key, value) => {
    setEntries((current) => {
      if (value === null) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      const prev = current[key];
      if (prev && prev.signature === value.signature) return current;
      return { ...current, [key]: value };
    });
  }, []);
  const value = useMemo(() => {
    const list = Object.values(entries);
    return {
      register,
      highlight,
      setHighlight,
      members: mergeMembers(list.map((entry) => entry.members)),
      netLabel: list.find((entry) => entry.netLabel)?.netLabel,
    };
  }, [entries, highlight, register]);
  return <KeyContext.Provider value={value}>{children}</KeyContext.Provider>;
}

/**
 * A card's hook: registers its measures with the section's key when there
 * is one. Returns whether the key is shared (so the card draws none of its
 * own), the highlighted measure's name, and its setter.
 */
export function useMeasureKey(members, netLabel) {
  const shared = useContext(KeyContext);
  const id = useId();
  const [localHighlight, setLocalHighlight] = useState(null);
  const signature = `${members.map((m) => `${m.id}:${m.muted ? 0 : 1}`).join(",")}|${netLabel ?? ""}`;
  const register = shared?.register;
  useEffect(() => {
    if (!register) return undefined;
    register(id, { members, netLabel, signature });
    return () => register(id, null);
    // members is re-read when its signature changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, id, signature]);
  if (shared) return { shared: true, highlight: shared.highlight, setHighlight: shared.setHighlight };
  return { shared: false, highlight: localHighlight, setHighlight: setLocalHighlight };
}

/** The key above a section's cards, from what they registered. */
export function SectionMeasureKey({ label = "Measures" }) {
  const shared = useContext(KeyContext);
  if (!shared || shared.members.length === 0) return null;
  return (
    <MeasureKey
      members={shared.members}
      netLabel={shared.netLabel}
      highlight={shared.highlight}
      onHighlight={shared.setHighlight}
      placement="section"
      label={label}
    />
  );
}

function Chip({ member, pinned, onHover, onPin }) {
  const color = member.muted ? MUTED_SWATCH : POLICY_COLORS[member.name];
  const face = (
    <>
      <span className="measure-key-swatch" style={{ "--swatch": color }} aria-hidden="true" />
      <span className="measure-key-label" aria-hidden="true">{shortName(member.id)}</span>
      {/* The full name for screen readers (the short one is for the eye) */}
      <span className="measure-key-full">
        {member.name}
        {member.muted ? ": no effect in the year shown" : ""}
      </span>
    </>
  );
  if (member.muted) {
    return (
      <li className="measure-key-chip is-muted" data-measure={member.id} title={member.name}>
        {face}
      </li>
    );
  }
  return (
    <li className="measure-key-chip-item" data-measure={member.id} title={member.name}>
      {/* Hover or focus highlights the measure; a click keeps it highlighted */}
      <button
        type="button"
        className={`measure-key-chip${pinned ? " is-active" : ""}`}
        aria-pressed={pinned}
        onMouseEnter={() => onHover(member.name)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(member.name)}
        onBlur={() => onHover(null)}
        onClick={() => onPin(member.name)}
      >
        {face}
      </button>
    </li>
  );
}

/**
 * The key itself: chips grouped by whether a measure raises or costs
 * revenue, the net line, and the measures with no effect folded away.
 *
 * @param {Object} props
 * @param {Array<{id: string, name: string, muted?: boolean}>} props.members
 * @param {string} [props.netLabel] - The net line's label ("Net change")
 * @param {string|null} [props.highlight]
 * @param {(name: string|null) => void} [props.onHighlight]
 * @param {"section"|"card"} [props.placement]
 */
export function MeasureKey({ members, netLabel, highlight = null, onHighlight, placement = "card", label }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(null);
  const [hovered, setHovered] = useState(null);
  // A pinned measure that leaves the key (deselected, or no effect this
  // year) no longer counts
  const pinnedLive = pinned && members.some((member) => member.name === pinned && !member.muted) ? pinned : null;
  // The charts follow the hovered chip, else the pinned one
  const wanted = hovered ?? pinnedLive;
  useEffect(() => {
    if (onHighlight && wanted !== highlight) onHighlight(wanted);
    // Only a change of chip moves the highlight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const pin = (name) => setPinned(pinnedLive === name ? null : name);
  const listId = useId();
  const active = members.filter((member) => !member.muted);
  const muted = members.filter((member) => member.muted);
  const groups = [
    ["Raises revenue", active.filter((member) => REVENUE_RAISING_NAMES.has(member.name))],
    ["Costs revenue", active.filter((member) => !REVENUE_RAISING_NAMES.has(member.name))],
  ].filter(([, items]) => items.length > 0);
  return (
    <div
      className={`measure-key is-${placement}`}
      role="group"
      aria-label={label ? `${label}: key` : "Key"}
    >
      {label && <span className="measure-key-title">{label}</span>}
      <div className="measure-key-scroll">
        {groups.map(([heading, items]) => (
          <div key={heading} className="measure-key-group">
            <span className="measure-key-heading">{heading}</span>
            <ul className="measure-key-chips">
              {items.map((member) => (
                <Chip
                  key={member.id}
                  member={member}
                  pinned={pinnedLive === member.name}
                  onHover={setHovered}
                  onPin={pin}
                />
              ))}
            </ul>
          </div>
        ))}
        {(netLabel || muted.length > 0) && (
          <div className="measure-key-group measure-key-extra">
            <ul className="measure-key-chips">
              {netLabel && (
                <li className="measure-key-chip is-net">
                  <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" className="measure-key-net-icon">
                    <line x1="0" y1="5" x2="18" y2="5" />
                    <circle cx="9" cy="5" r="3" />
                  </svg>
                  <span className="measure-key-label">{netLabel}</span>
                </li>
              )}
              {muted.length > 0 && (
                <li className="measure-key-more-item">
                  <button
                    type="button"
                    className="measure-key-more"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setOpen((isOpen) => !isOpen)}
                  >
                    +{muted.length} with no effect
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {muted.length > 0 && (
        // Listed even while folded (hidden), so every selected measure is
        // always in the key
        <ul id={listId} className="measure-key-chips measure-key-muted" hidden={!open}>
          {muted.map((member) => (
            <Chip key={member.id} member={member} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default MeasureKey;
