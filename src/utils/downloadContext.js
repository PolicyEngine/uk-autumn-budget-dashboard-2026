import { createContext, useContext } from "react";

/**
 * What a downloaded chart says it shows beyond its own card: the policies
 * selected in the band ("All 9 policies", or their names; null on a view
 * the selection does not drive) and the provisional label while the
 * figures are provisional. App provides it per view; ChartDownloadMenu
 * reads it into the file's frame (exportFrame).
 */
export const DownloadContext = createContext({ policies: null, provisional: null });

export const useDownloadContext = () => useContext(DownloadContext);

/** "All 9 policies", one policy's name, or the names joined. */
export function policiesLabel(selectedIds, policies) {
  if (!selectedIds?.length) return null;
  if (selectedIds.length === policies.length) return `All ${policies.length} policies`;
  const names = selectedIds.map((id) => policies.find((policy) => policy.id === id)?.name ?? id);
  return names.length === 1 ? names[0] : `${names.length} of ${policies.length} policies: ${names.join(", ")}`;
}

/**
 * The Options choices of the card a download menu sits in, as its pills
 * read: from the menu up to the largest element that holds no other
 * download menu (the card), its control bars' text. Read when a download
 * runs, so it is what the reader sees.
 */
export function cardSelection(menuNode) {
  if (!menuNode) return "";
  let card = menuNode;
  while (
    card.parentElement &&
    !card.parentElement.matches(".tab-panel, .results-container, body") &&
    card.parentElement.querySelectorAll(".chart-download").length <= 1
  ) {
    card = card.parentElement;
  }
  const parts = [];
  card.querySelectorAll(".control-bar").forEach((bar) => {
    bar.querySelectorAll(":scope > *").forEach((child) => {
      const summary = child.querySelector?.(".control-bar-summary");
      const text = (summary ?? child).textContent.replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    });
  });
  return parts.join(" · ");
}
