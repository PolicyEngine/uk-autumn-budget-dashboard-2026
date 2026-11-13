import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ImprovementsNote from "./ImprovementsNote";
import { IMPROVEMENTS_NOTE } from "./improvementsText";

// The note as Max approved it (28 October 2026, "Use the widened text"),
// character for character: the coordinator's whats-improving-note.md, less
// the date and the poverty and people-affected item (30 October 2026), and
// with the adoption candidate's completed savings and Pension Tax
// Allowance work removed (E3 and PR 376). The later-update lead remains;
// the upstream model already has the Budget measures from 2.170.0
const APPROVED = `What we're improving

We are working on:
- projecting household electricity spending with retail energy prices rather than general inflation.
`;

// The note as plain text, the approved file's layout: the title, a blank
// line, then each part's lead and its items as "- " bullets, a blank line
// between the parts
const asText = ({ title, parts }) =>
  `${[title, "", ...parts.flatMap(({ lead, items }, index) => [...(index ? [""] : []), lead, ...items.map((item) => `- ${item}`)])].join("\n")}\n`;

describe("What we're improving (ImprovementsNote)", () => {
  it("keeps the remaining work after the selected integrations", () => {
    expect(asText(IMPROVEMENTS_NOTE)).toBe(APPROVED);
    expect(IMPROVEMENTS_NOTE.parts.map(({ items }) => items.length)).toEqual([1]);
  });

  // PR 376 and E3 complete the PTA and savings source work in this
  // adoption candidate. Other work still has no next-update promise;
  // the generic upstream implementation item was already completed.
  it("promises nothing for the next update, and lists no finished work", () => {
    for (const { lead, items } of IMPROVEMENTS_NOTE.parts) {
      expect(lead).not.toMatch(/next update/i);
      for (const item of items) expect(item).not.toMatch(/adding the Budget's measures to PolicyEngine UK|add national figures for the savings income tax rise|give the Pension Tax Allowance|trading allowance to miscellaneous income|overlapping benefits|road fuel gases/);
    }
    // Every item but the last of a list ends with a semicolon, the last with a full stop
    for (const { items } of IMPROVEMENTS_NOTE.parts) {
      items.forEach((item, index) => expect(item).toMatch(index === items.length - 1 ? /\.$/ : /;$/));
    }
  });

  it("shows it as a titled section, its leads as lines and its bullets as lists", () => {
    render(<ImprovementsNote />);
    const note = screen.getByRole("region", { name: "What we're improving" });
    expect(within(note).getByRole("heading", { level: 3 })).toHaveTextContent(/^What we're improving$/);
    expect([...note.querySelectorAll("p")].map((line) => line.textContent)).toEqual(IMPROVEMENTS_NOTE.parts.map(({ lead }) => lead));
    const lists = within(note).getAllByRole("list");
    expect(lists.map((list) => within(list).getAllByRole("listitem").map((item) => item.textContent))).toEqual(IMPROVEMENTS_NOTE.parts.map(({ items }) => items));
    // Nothing else in it: its text is the approved note's, less the line breaks and bullets
    expect(note.textContent).toBe(APPROVED.replace(/\n- /g, "").replace(/\n/g, ""));
  });
});
