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
