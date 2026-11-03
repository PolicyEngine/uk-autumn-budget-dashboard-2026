import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ImprovementsNote from "./ImprovementsNote";
import { IMPROVEMENTS_NOTE } from "./improvementsText";

// The note as Max approved it (28 October 2026, "Use the widened text"),
// character for character: the coordinator's whats-improving-note.md, less
// the date and the poverty and people-affected item (30 October 2026)
const APPROVED = `What we're improving

The next update of these results will:
- add national figures for the savings income tax rise, once we have improved our savings income data (the calculator already includes it);
- apply the trading allowance to miscellaneous income as well as trading income, which will raise our estimate of its cost;
- correct how the Carer's Allowance taper interacts with overlapping benefits, such as the State Pension, in 2030-31;
- extend the fuel duty cut to road fuel gases (LPG and natural gas), as the government's costing does;
- give the Pension Tax Allowance to everyone who reaches State Pension age during the tax year.

We are also working on:
- projecting household electricity spending with retail energy prices rather than general inflation;
- adding the Budget's measures to PolicyEngine UK itself, so anyone using our open-source model can run them.
`;

// The note as plain text, the approved file's layout: the title, a blank
// line, then each part's lead and its items as "- " bullets, a blank line
// between the parts
const asText = ({ title, parts }) =>
  `${[title, "", ...parts.flatMap(({ lead, items }, index) => [...(index ? [""] : []), lead, ...items.map((item) => `- ${item}`)])].join("\n")}\n`;

describe("What we're improving (ImprovementsNote)", () => {
  it("says exactly the approved note, every item kept", () => {
    expect(asText(IMPROVEMENTS_NOTE)).toBe(APPROVED);
    expect(IMPROVEMENTS_NOTE.parts.map(({ items }) => items.length)).toEqual([5, 2]);
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
