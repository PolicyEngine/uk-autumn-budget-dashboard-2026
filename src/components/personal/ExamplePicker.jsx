import { useEffect, useId, useRef, useState } from "react";

/**
 * The household card's examples: a quiet button that opens a menu of
 * example households in groups, each with its name and one line on what it
 * shows. Choosing one fills the form only; nothing is calculated.
 * Keyboard: the button opens it (Enter, Space or Down); Up and Down move
 * through the items, Home and End jump, Escape or Tab closes it and
 * returns to the button.
 *
 * @param {Object} props
 * @param {Array<{title: string, examples: Array<{id, label, description}>}>} props.groups
 * @param {string|null} props.value - The example the form was last filled from
 * @param {(id: string) => void} props.onChoose
 */
export default function ExamplePicker({ groups, value, onChoose }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const items = () => [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])];
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  // On opening: focus the chosen example, or the first
  useEffect(() => {
    if (!open) return undefined;
    const list = items();
    (list.find((item) => item.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
    const onPointer = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKeyDown = (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      list[(move + list.length) % list.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="example-picker">
      <button
        ref={buttonRef}
        type="button"
        className="example-picker-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z M19 3v4M17 5h4M5 17v4M3 19h4" />
        </svg>
        Examples
        <svg
          className="example-picker-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="example-menu"
          role="menu"
          aria-label="Start from an example"
          onKeyDown={onMenuKeyDown}
        >
          {groups.map((group) => (
            <div key={group.title} className="example-menu-group" role="group" aria-label={group.title}>
              <p className="example-menu-title" aria-hidden="true">
                {group.title}
              </p>
              {group.examples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === example.id}
                  tabIndex={-1}
                  className="example-menu-item"
                  onClick={() => {
                    onChoose(example.id);
                    close();
                  }}
                >
                  <span className="example-menu-name">{example.label}</span>
                  <span className="example-menu-description">{example.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
