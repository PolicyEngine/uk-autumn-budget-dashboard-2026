import { fireEvent } from "@testing-library/react";
import { expect } from "vitest";

// The formats every card's Download offers, in the menu's order
export const STANDARD_FORMATS = ["csv", "png", "svg"];

/**
 * Every Download menu in `scope` (not disabled) offers the standard
 * formats: opens each and reads its items. Returns the menus it checked,
 * as { name, formats }.
 */
export function downloadMenus(scope) {
  const menus = [];
  const selector = ".chart-download-button:not([disabled])";
  const count = scope.querySelectorAll(selector).length;
  for (let index = 0; index < count; index += 1) {
    // Found afresh each time: opening a menu can re-render the card
    const button = scope.querySelectorAll(selector)[index];
    if (!button) break;
    const name = button.getAttribute("aria-label");
    fireEvent.click(button);
    const menu = document.getElementById(button.getAttribute("aria-controls"));
    const formats = menu ? [...menu.querySelectorAll("[data-format]")].map((item) => item.dataset.format) : [];
    menus.push({ name, formats });
    fireEvent.keyDown(document, { key: "Escape" });
  }
  return menus;
}

export function expectStandardDownloads(scope) {
  const menus = downloadMenus(scope);
  for (const menu of menus) expect(menu.formats, menu.name).toEqual(STANDARD_FORMATS);
  return menus.length;
}
