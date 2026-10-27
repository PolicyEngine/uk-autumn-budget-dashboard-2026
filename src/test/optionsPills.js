import { fireEvent, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Every Options pill in `scope` names every choice its dialog holds: opens
 * each pill and checks that its label holds each group's current choice
 * (a Segmented group's checked option, a custom group's summary), except a
 * show/hide group at its default. Returns how many pills it checked.
 */
export function expectCompletePills(scope) {
  const buttons = [...scope.querySelectorAll(".control-bar-button")];
  for (const button of buttons) {
    const label = button.querySelector(".control-bar-summary").textContent;
    fireEvent.click(button);
    const dialog = within(button.closest(".control-bar-options")).getByRole("dialog");
    for (const group of dialog.querySelectorAll(".control-bar-group")) {
      if (group.dataset.inSummary === "false") continue;
      // The years' own lists, inside the years compared, are summed up by it
      if (group.parentElement.closest('.control-bar-group[role="group"]')) continue;
      // A custom group (the years compared) carries its own summary
      const custom = group.getAttribute("role") === "group";
      const checked = !custom && group.querySelector('[role="radio"][aria-checked="true"]');
      const wanted = custom ? group.dataset.summary : checked?.dataset.summary;
      if (wanted) expect(label, `${button.getAttribute("aria-label")} lacks "${wanted}"`).toContain(wanted);
    }
    fireEvent.keyDown(dialog, { key: "Escape" });
  }
  return buttons.length;
}

/**
 * Choose `label` in `scope`'s Options pill (its only one, or the one whose
 * dialog offers it): opens the pill, picks the radio, closes the dialog.
 */
export function chooseOption(scope, label) {
  for (const button of scope.querySelectorAll(".control-bar-button")) {
    fireEvent.click(button);
    const dialog = within(button.closest(".control-bar-options")).getByRole("dialog");
    const radio = within(dialog).queryByRole("radio", { name: label });
    if (radio) {
      fireEvent.click(radio);
      const open = button.closest(".control-bar-options").querySelector('[role="dialog"]');
      if (open) fireEvent.keyDown(open, { key: "Escape" });
      return;
    }
    fireEvent.keyDown(dialog, { key: "Escape" });
  }
  throw new Error(`No option "${label}"`);
}

/** The label of `scope`'s first Options pill: every current choice ("After · Spread"). */
export const optionsLabel = (scope) => scope.querySelector(".control-bar-summary")?.textContent ?? "";
