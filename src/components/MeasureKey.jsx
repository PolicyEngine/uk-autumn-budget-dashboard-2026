import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { shortNameOf } from "../utils/policyDetails";
import { MUTED_SWATCH } from "../utils/legendMembership";
import "./MeasureKey.css";

/**
 * The measure key: one compact row of chips for the measures a chart (or a
 * section of charts) colours by, in place of a long legend per card.
 *
 * - Each chip is a measure's colour and short name (its full name in the
 *   tooltip and accessible name), in one unlabelled row: measures that
 *   raise revenue, then those that cost it, then the net line. The colour,
 *   group and order are the
 *   catalogue's (#104); the short name is policyDetails.js's, while it
 *   describes the published measure, else the published name.
 * - Measures with no effect in the year shown (`muted`, legendMembership)
 *   are folded into one "+N with no effect" chip that opens them; they stay
 *   in the key, so no measure silently disappears. Why each is £0 stays in
 *   the card's More info.
 * - Clicking a chip pins it: the pinned measures stay full colour in every
 *   chart that reads the same key and the others fade. Clicking more chips
 *   adds them to the set; clicking a pinned chip takes it out, and "Clear"
 *   unpins them all. Hovering or focusing a chip previews that measure on
 *   top of the pinned set. Tooltips keep listing every measure, so totals
 *   still add up while some are faded.
 *
 * A section shares one key: wrap its cards in <MeasureKeyProvider> and put
 * <SectionMeasureKey /> above them. Each card calls useMeasureKey(members):
 * inside a provider it registers its measures with the section's key and
 * draws none of its own; on its own it draws the key in its legend row.
 */

const KeyContext = createContext(null);

/** The opacity of a measure's bars while `highlight` is set. */
export const FADED_OPACITY = 0.18;

/** A member's highlight key: the series key its charts draw it under. */
const keyOf = (member) => member.key ?? `measure:${member.id}`;

/**
 * Whether a series is in the highlight: `highlight` is the highlighted
 * series keys (or one key); null or empty highlights none.
 */
export function isHighlighted(highlight, seriesKey) {
  if (!highlight || highlight.length === 0) return false;
  return Array.isArray(highlight) ? highlight.includes(seriesKey) : highlight === seriesKey;
}

/** The net line's key in the highlight: its chip is chosen like a measure's. */
export const NET_KEY = "net";

/**
 * Opacity for the net line (or dots): full when nothing is chosen or the
 * net is among the chosen, faded while only measures are.
 */
export function netOpacity(highlight) {
  if (!highlight || highlight.length === 0) return 1;
  return isHighlighted(highlight, NET_KEY) ? 1 : FADED_OPACITY;
}

/** Fill opacity for a measure's series given the highlighted series keys. */
export function measureOpacity(highlight, seriesKey) {
  if (!highlight || highlight.length === 0) return 1;
  return isHighlighted(highlight, seriesKey) ? 1 : FADED_OPACITY;
}

/** Members from several cards as one list: a measure is muted only when it
 * is muted in every card that lists it; the order is the first card's. */
export function mergeMembers(lists, catalogue) {
  const byId = new Map();
  for (const list of lists) {
    for (const member of list) {
      const seen = byId.get(member.id);
      if (!seen) byId.set(member.id, { ...member });
      else if (!member.muted) seen.muted = false;
    }
  }
  // Keep the catalogue's order (every list is in it already)
  const order = (id) => catalogue?.byId.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...byId.values()].sort((a, b) => order(a.id) - order(b.id));
}

/** A section's shared key and highlight. */
export function MeasureKeyProvider({ children }) {
  const catalogue = useMeasureCatalogue();
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
      members: mergeMembers(list.map((entry) => entry.members), catalogue),
      netLabel: list.find((entry) => entry.netLabel)?.netLabel,
    };
  }, [entries, highlight, register, catalogue]);
  return <KeyContext.Provider value={value}>{children}</KeyContext.Provider>;
}

/**
 * A card's hook: registers its measures with the section's key when there
 * is one. Returns whether the key is shared (so the card draws none of its
 * own), the highlighted measure's series key, and its setter.
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
export function SectionMeasureKey({ label = "Policies" }) {
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

function Chip({ member, color, pinned, onHover, onPin }) {
  // The short name once, on the chip; the full name in its tooltip (title)
  // and, on the button, after the short one: an accessible name starts
  // with the visible text (WCAG 2.5.3, label in name). No second, hidden
  // copy of the name, so the page's text reads each measure once.
  const full = member.name;
  const face = (
    <>
      <span className="measure-key-swatch" style={{ "--swatch": color }} aria-hidden="true" />
      <span className="measure-key-label">{shortNameOf(member)}</span>
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
        aria-label={shortNameOf(member) === full ? undefined : `${shortNameOf(member)}: ${full}`}
        aria-pressed={pinned}
        onMouseEnter={() => onHover(keyOf(member))}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(keyOf(member))}
        onBlur={() => onHover(null)}
        onClick={() => onPin(keyOf(member))}
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
 * @param {Array<{id: string, key?: string, name: string, description?: string, muted?: boolean}>} props.members
 *   (legendMembership's)
 * @param {string} [props.netLabel] - The net line's label ("Net change")
 * @param {string|null} [props.highlight]
 * @param {(seriesKey: string|null) => void} [props.onHighlight]
 * @param {"section"|"card"} [props.placement]
 */
export function MeasureKey({ members, netLabel, highlight = null, onHighlight, placement = "card", label }) {
  const catalogue = useMeasureCatalogue();
  const colorOf = (member) => (member.muted ? MUTED_SWATCH : catalogue.byId.get(member.id)?.color ?? MUTED_SWATCH);
  const raises = (member) => catalogue.byId.get(member.id)?.direction === "revenue";
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [hovered, setHovered] = useState(null);
  // A pinned measure that leaves the key (deselected, or no effect this
  // year) no longer counts
  const live = new Set(members.filter((member) => !member.muted).map(keyOf));
  if (netLabel) live.add(NET_KEY);
  const pinnedLive = pinned.filter((key) => live.has(key));
  // The charts follow the pinned set, with a hovered chip previewed on top;
  // null when nothing is pinned or hovered
  const wantedList = hovered && !pinnedLive.includes(hovered) ? [...pinnedLive, hovered] : pinnedLive;
  const wanted = wantedList.length > 0 ? wantedList : null;
  const wantedKey = wanted ? wanted.join("\u0000") : "";
  useEffect(() => {
    const currentKey = highlight ? [highlight].flat().join("\u0000") : "";
    if (onHighlight && wantedKey !== currentKey) onHighlight(wanted);
    // Only a change of chips moves the highlight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);
  const pin = (key) =>
    setPinned(pinnedLive.includes(key) ? pinnedLive.filter((item) => item !== key) : [...pinnedLive, key]);
  const clear = () => {
    setPinned([]);
    setHovered(null);
  };
  const listId = useId();
  const active = members.filter((member) => !member.muted);
  const muted = members.filter((member) => member.muted);
  // One flat row, no group labels: raising measures first, then costing ones
  const ordered = [...active.filter(raises), ...active.filter((member) => !raises(member))];
  return (
    <div
      className={`measure-key is-${placement}`}
      role="group"
      aria-label={label ? `${label}: key` : "Key"}
    >
      {label && <span className="measure-key-title">{label}</span>}
      <div className="measure-key-scroll">
        {ordered.length > 0 && (
          <div className="measure-key-group">
            <ul className="measure-key-chips">
              {ordered.map((member) => (
                <Chip
                  key={member.id}
                  member={member}
                  color={colorOf(member)}
                  pinned={pinnedLive.includes(keyOf(member))}
                  onHover={setHovered}
                  onPin={pin}
                />
              ))}
            </ul>
          </div>
        )}
        {(netLabel || muted.length > 0 || pinnedLive.length > 0) && (
          <div className="measure-key-group measure-key-extra">
            <ul className="measure-key-chips">
              {netLabel && (
                // The net line is chosen like a measure: alone, the measures
                // fade; with measures, it stays with them
                <li className="measure-key-chip-item" data-net="">
                  <button
                    type="button"
                    className={`measure-key-chip is-net${pinnedLive.includes(NET_KEY) ? " is-active" : ""}`}
                    aria-label={netLabel}
                    aria-pressed={pinnedLive.includes(NET_KEY)}
                    onMouseEnter={() => setHovered(NET_KEY)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(NET_KEY)}
                    onBlur={() => setHovered(null)}
                    onClick={() => pin(NET_KEY)}
                  >
                    <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" className="measure-key-net-icon">
                      <line x1="0" y1="5" x2="18" y2="5" />
                      <circle cx="9" cy="5" r="3" />
                    </svg>
                    <span className="measure-key-label">{netLabel}</span>
                  </button>
                </li>
              )}
              {pinnedLive.length > 0 && (
                <li className="measure-key-clear-item">
                  <button
                    type="button"
                    className="measure-key-clear"
                    onClick={clear}
                    aria-label={`Clear the ${pinnedLive.length === 1 ? "highlighted policy" : `${pinnedLive.length} highlighted policies`}`}
                  >
                    Clear
                  </button>
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
            <Chip key={member.id} member={member} color={colorOf(member)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default MeasureKey;
