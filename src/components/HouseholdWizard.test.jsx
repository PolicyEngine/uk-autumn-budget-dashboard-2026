import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import HouseholdCalculator, { FORM_SECTIONS, WIZARD_DEFAULTS, resetSavedWizard } from "./HouseholdCalculator";
import { DEFAULT_SALARY, DEFAULT_SPENDING, REGIONAL_RENT } from "../utils/householdDefaults";

beforeEach(() => {
  resetSavedWizard();
});

/** A question's box, by the field it asks (null when not asked). */
const field = (id) => document.querySelector(`[data-row="${id}"]`);
/** The questions shown, in order. */
const fields = () => [...document.querySelectorAll(".household-field")].map((row) => row.dataset.row);
const moreToggle = () => screen.getByRole("button", { name: /^More details/ });
/** Open More details (closed at first). */
const openMore = () => {
  if (moreToggle().getAttribute("aria-expanded") !== "true") fireEvent.click(moreToggle());
};
const select = (name) => screen.getByRole("combobox", { name });
/** Choose an option of a select by its text. */
const choose = (name, option) => {
  const box = select(name);
  fireEvent.change(box, { target: { value: within(box).getByRole("option", { name: option }).value } });
};
/** A select's chosen option, as shown. */
const chosen = (name) => {
  const box = select(name);
  return box.options[box.selectedIndex].textContent;
};
const box = (name) => screen.getByRole("spinbutton", { name });
const seatBox = () => screen.getByRole("combobox", { name: "Constituency" });
/** Pick a constituency by typing its name and choosing it from the list. */
const pickSeat = (name) => {
  fireEvent.focus(seatBox());
  fireEvent.change(seatBox(), { target: { value: name } });
  fireEvent.click(within(screen.getByRole("listbox", { name: (label) => label !== "Households" })).getByRole("option", { name }));
};
/** The region the constituency sets, as shown under it. */
const regionShown = () => document.getElementById("region-constituency").textContent;
const cards = () => screen.getByRole("region", { name: "Choose a household" });
const examples = cards;
// A card in the grid, or, once a household is chosen and the cards fold
// into a strip, its chip
const exampleItem = (label) => {
  const name = new RegExp(`^${label}`);
  return within(examples()).queryByRole("button", { name }) ?? within(examples()).getByRole("option", { name });
};
/** Whether an example's card (aria-pressed) or chip (aria-selected) is the one chosen. */
const isChosen = (item) => (item.getAttribute("aria-pressed") ?? item.getAttribute("aria-selected")) === "true";
const applyExample = (label) => fireEvent.click(exampleItem(label));
// Your household's card, or its chip once the cards fold
const yoursCard = () =>
  within(cards()).queryByRole("button", { name: /^Your household/ }) ??
  within(cards()).getByRole("option", { name: /^Your household/ });
/** Whether the form below the cards is open (its panel, which Your household controls). */
const formIsOpen = () => document.getElementById(yoursCard().getAttribute("aria-controls"))?.dataset.open === "true";
/** Open the form below the cards ("Your household"), unless it is open. */
const openForm = () => {
  if (!formIsOpen()) fireEvent.click(yoursCard());
};
/** The view, with its form open. */
const renderForm = (ui = <HouseholdCalculator />) => {
  const view = render(ui);
  openForm();
  return view;
};

describe("the personal impact form", () => {
  it("is one card of boxes in sections, the essentials first and the rest in More details, with the results below it", () => {
    renderForm(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    // No steps and no "See results"; no results box before Calculate (the
    // cards say what to do)
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Results" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Choose an example/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your household" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "You" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Family and home" })).toBeInTheDocument();
    // More details starts closed, with how many questions it holds
    const more = screen.getByRole("button", { name: "More details 11 questions" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const essentials = ["current_age", "current_salary", "region", "has_partner", "children_count", "tenure", "monthly_rent"];
    expect(fields()).toEqual(essentials);
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(more.getAttribute("aria-controls"))).toBeVisible();
    for (const name of ["Other income", "Pension and student loan", "Spending", "Council tax and benefits"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(fields()).toEqual([
      ...essentials,
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
      "petrol_spending_per_year",
      "diesel_spending_per_year",
      "electricity_spending_per_year",
      "council_tax_band",
      "claims_universal_credit",
    ]);
    expect(FORM_SECTIONS).toHaveLength(3);
    expect(box("Age")).toHaveValue(30);
    expect(seatBox()).toHaveValue("");
    expect(regionShown()).toBe("North West, until you pick a constituency");
    expect(chosen("Partner")).toBe("No");
    expect(chosen("Housing")).toBe("Rent privately");
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.NORTH_WEST);
    expect(chosen("Council tax band")).toBe("D");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("changes an answer in its box, with steppers for amounts", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Age: 1 more" }));
    expect(box("Age")).toHaveValue(31);
    pickSeat("Holborn and St Pancras");
    expect(seatBox()).toHaveValue("Holborn and St Pancras");
    expect(regionShown()).toBe("London");
    // The rent follows the region until it is changed
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON);
    fireEvent.click(screen.getByRole("button", { name: "Rent: £25 more" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON + 25 - (REGIONAL_RENT.LONDON % 25));
    fireEvent.click(screen.getByRole("button", { name: "Use the regional average" }));
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.LONDON);
    fireEvent.change(box("Salary in 2026"), { target: { value: "52000" } });
    expect(box("Salary in 2026")).toHaveValue(52000);
  });

  it("starts every answer at its default, with the sources said", () => {
    renderForm();
    expect(box("Salary in 2026")).toHaveValue(DEFAULT_SALARY);
    expect(screen.getByText(/UK median salary in April 2026 \(ONS Annual Survey of Hours and Earnings/)).toBeInTheDocument();
    expect(box("Rent")).toHaveValue(REGIONAL_RENT.NORTH_WEST);
    expect(screen.getByText(/average private rent in North West \(ONS, September 2026\)/)).toBeInTheDocument();
    // A long note is the box's description, behind an "i" by its label
    expect(box("Rent")).toHaveAccessibleDescription(/average private rent in North West/);
    expect(screen.getByRole("button", { name: "About Rent" })).toBeInTheDocument();
    openMore();
    expect(chosen("Student loan plan")).toBe("No loan");
    expect(box("Petrol")).toHaveValue(DEFAULT_SPENDING.petrol);
    expect(box("Diesel")).toHaveValue(DEFAULT_SPENDING.diesel);
    expect(chosen("Universal Credit")).toBe("Yes");
    // Only the answers the household calculation reads
    for (const id of ["rail_spending_per_year", "student_loan_balance", "retirement_age"]) {
      expect(field(id)).toBeNull();
    }
    expect(WIZARD_DEFAULTS.student_loan_plan).toBe("NONE");
  });

  it("asks rent only of renters, and the partner's answers only with a partner", () => {
    renderForm();
    choose("Housing", "Own outright");
    expect(field("monthly_rent")).toBeNull();
    expect(field("partner_salary")).toBeNull();
    choose("Partner", "Yes");
    expect(box("Partner's age")).toHaveValue(30);
    expect(box("Partner's salary in 2026")).toHaveValue(DEFAULT_SALARY);
    openMore();
    expect(field("partner_private_pension_per_year")).not.toBeNull();
  });

  it("asks one age per child, their education from 16, and childcare only with children", () => {
    renderForm();
    openMore();
    expect(field("monthly_childcare")).toBeNull();
    choose("Children", "2");
    expect(chosen("Children")).toBe("2");
    expect(box("Child 1's age")).toHaveValue(5);
    expect(screen.queryByRole("combobox", { name: /Child 1 in full-time education/ })).toBeNull();
    // The age in the chosen year, which the calculation uses as entered
    expect(field("child_0")).toHaveTextContent("Age in 2027-28, from 0 to 19.");
    fireEvent.change(box("Child 2's age"), { target: { value: "17" } });
    expect(chosen("Child 2 in full-time education (non-advanced)")).toBe("Yes");
    choose("Child 2 in full-time education (non-advanced)", "No");
    expect(chosen("Child 2 in full-time education (non-advanced)")).toBe("No");
    expect(field("monthly_childcare")).not.toBeNull();
    choose("Children", "0");
    expect(field("child_0")).toBeNull();
    expect(field("monthly_childcare")).toBeNull();
  });

  it("asks a child's age in the year chosen, not in 2026", () => {
    renderForm(<HouseholdCalculator year={2031} />);
    choose("Children", "1");
    expect(field("child_0")).toHaveTextContent("Age in 2031-32, from 0 to 19.");
    expect(field("child_0")).not.toHaveTextContent("2026");
  });

  it("says why a child of 20 or over is not taken, never dropping them silently", () => {
    renderForm();
    choose("Children", "1");
    fireEvent.change(box("Child 1's age"), { target: { value: "21" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Children are 0 to 19.");
    fireEvent.blur(box("Child 1's age"));
    expect(box("Child 1's age")).toHaveValue(19);
    expect(screen.getByRole("alert")).toHaveTextContent("21 was changed to 19.");
  });

  it("asks private pensions, the partner's only with a partner, and hides the Council Tax band in Northern Ireland", () => {
    renderForm();
    openMore();
    expect(box("Private or workplace pension")).toHaveValue(0);
    expect(field("partner_private_pension_per_year")).toBeNull();
    expect(field("council_tax_band")).not.toBeNull();
    pickSeat("Belfast South and Mid Down");
    expect(field("council_tax_band")).toBeNull();
  });

  it("asks the loan plan, never the balance, with the chosen plan's note", () => {
    renderForm();
    openMore();
    const plans = within(select("Student loan plan"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(plans).toEqual(["No loan", "Plan 1", "Plan 2", "Plan 4", "Plan 5", "Postgraduate"]);
    choose("Student loan plan", "Plan 2");
    expect(chosen("Student loan plan")).toBe("Plan 2");
    expect(select("Student loan plan")).toHaveAccessibleDescription("England or Wales, Sept 2012 to July 2023");
  });

  it("asks for the State Pension only at State Pension age, prefilled with the full rate", () => {
    renderForm(<HouseholdCalculator year={2029} />);
    openMore();
    expect(field("state_pension_per_year")).toBeNull();
    fireEvent.change(box("Age"), { target: { value: "72" } });
    expect(box("Your State Pension")).toHaveValue(13697);
    expect(screen.getByText(/Prefilled with the full new State Pension for 2029-30 \(£13,697\)/)).toBeInTheDocument();
    fireEvent.change(box("Your State Pension"), { target: { value: "9000" } });
    expect(box("Your State Pension")).toHaveValue(9000);
  });

  it("shows eight cards: your household first, then seven examples, each a name, who they are and its measure", () => {
    render(<HouseholdCalculator />);
    const buttons = within(cards()).getAllByRole("button");
    expect(buttons.map((item) => item.querySelector(".household-card-name").textContent)).toEqual([
      "Your household",
      "A 22-year-old renting",
      "A 19-year-old apprentice",
      "A pensioner on the State Pension",
      "A family on Universal Credit",
      "A graduate on £35,000",
      "A driver with a long commute",
      "A higher earner on £110,000",
    ]);
    expect(buttons.every((item) => item.querySelector(".household-card-description").textContent.length > 0)).toBe(true);
    // No catalogue here: no example features a measure it does not publish
    // (#185 on #104), so no tag
    expect(buttons.slice(1).every((item) => item.querySelector(".household-card-tag") === null)).toBe(true);
    // Every card is chosen the same way (aria-pressed); your household
    // also opens the form it controls
    expect(buttons.every((item) => item.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.queryByRole("form", { name: "Your household" })).not.toBeInTheDocument();
    fireEvent.click(yoursCard());
    expect(isChosen(yoursCard())).toBe(true);
    expect(formIsOpen()).toBe(true);
    expect(document.getElementById(yoursCard().getAttribute("aria-controls"))).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Your household" })).toBeInTheDocument();
  });

  it("fills the form from an example card, still editable", () => {
    render(<HouseholdCalculator />);
    applyExample("A 22-year-old renting");
    // Chosen: the card is marked; no note or "Change these answers" under
    // the cards (the card says what the example is)
    expect(isChosen(exampleItem("A 22-year-old renting"))).toBe(true);
    expect(screen.queryByText(/Rents privately at £900 a month/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change these answers" })).not.toBeInTheDocument();
    // Your household, chosen from it: the example's answers, named at the
    // top of the form; the example is no longer the one chosen
    fireEvent.click(yoursCard());
    expect(isChosen(yoursCard())).toBe(true);
    expect(isChosen(exampleItem("A 22-year-old renting"))).toBe(false);
    expect(screen.getByText("Renter, 22", { selector: ".household-start-from strong" })).toBeInTheDocument();
    expect(box("Age")).toHaveValue(22);
    expect(box("Salary in 2026")).toHaveValue(25000);
    fireEvent.change(box("Salary in 2026"), { target: { value: "26000" } });
    expect(isChosen(yoursCard())).toBe(true);
    // Another example: the note goes
    applyExample("A 19-year-old apprentice");
    expect(document.querySelector(".household-start-from")).toBeNull();
  });

  it("opens the form with an example's answers from Your household, Calculate there to change one and calculate again", () => {
    render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    applyExample("A pensioner on the State Pension");
    fireEvent.click(yoursCard());
    expect(formIsOpen()).toBe(true);
    expect(isChosen(yoursCard())).toBe(true);
    expect(isChosen(exampleItem("A pensioner on the State Pension"))).toBe(false);
    expect(screen.getByText(/Starting from:/)).toHaveTextContent("Starting from: Pensioner. Change anything, then Calculate.");
    expect(box("Age")).toHaveValue(70);
    // Calculate is there, as for your own answers
    expect(screen.getByRole("button", { name: /^Calcul/ })).toBeVisible();
  });

  it("closes the form again from Your household once it is chosen", () => {
    render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    applyExample("A pensioner on the State Pension");
    fireEvent.click(yoursCard());
    expect(formIsOpen()).toBe(true);
    fireEvent.click(yoursCard());
    expect(formIsOpen()).toBe(false);
    // Nothing calculated for it: nothing chosen, the full grid again
    expect(isChosen(yoursCard())).toBe(false);
    expect(within(cards()).queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("folds the cards into a strip of chips once a household is chosen, and opens them again from Show all households", () => {
    render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    // Nothing chosen: the full grid, no strip, no toggle
    expect(within(cards()).queryByRole("listbox")).not.toBeInTheDocument();
    expect(within(cards()).queryByRole("button", { name: "Show all households" })).not.toBeInTheDocument();
    applyExample("A 22-year-old renting");
    // Folded: the grid's cards are hidden; eight chips, Your household first
    const strip = within(cards()).getByRole("listbox", { name: "Households" });
    const chips = within(strip).getAllByRole("option").slice(1);
    expect(within(strip).getAllByRole("option")).toHaveLength(8);
    expect(within(strip).getAllByRole("option")[0]).toHaveTextContent("Your household");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Renter, 22",
      "Apprentice",
      "Pensioner",
      "UC family",
      "Graduate",
      "Commuter",
      "High earner",
    ]);
    // The full name on hover, the short one cut if it runs out of room
    expect(chips[0]).toHaveAttribute("title", "A 22-year-old renting");
    expect(chips[0]).toHaveAttribute("aria-selected", "true");
    expect(chips[0]).toHaveAttribute("tabindex", "0");
    expect(within(cards()).queryByRole("button", { name: /^A 19-year-old apprentice/ })).not.toBeInTheDocument();
    expect(yoursCard()).toHaveClass("household-chip");
    expect(yoursCard()).toHaveAttribute("aria-selected", "false");
    // Another chip: switches, still folded
    fireEvent.click(chips[2]);
    expect(isChosen(exampleItem("A pensioner on the State Pension"))).toBe(true);
    expect(within(cards()).getByRole("listbox", { name: "Households" })).toBeInTheDocument();
    // The arrow keys move between chips; Enter chooses
    const pensioner = exampleItem("A pensioner on the State Pension");
    fireEvent.keyDown(pensioner, { key: "ArrowRight" });
    expect(document.activeElement).toBe(exampleItem("A family on Universal Credit"));
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement).toBe(exampleItem("A higher earner on £110,000"));
    fireEvent.keyDown(document.activeElement, { key: "Enter" });
    expect(isChosen(exampleItem("A higher earner on £110,000"))).toBe(true);
    // Home and Enter: Your household, chosen with its tick, the form open
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(document.activeElement).toBe(yoursCard());
    fireEvent.keyDown(document.activeElement, { key: "Enter" });
    expect(yoursCard()).toHaveAttribute("aria-selected", "true");
    expect(isChosen(exampleItem("A higher earner on £110,000"))).toBe(false);
    expect(formIsOpen()).toBe(true);
    // Show all households: the grid again; a card there folds it
    const toggle = within(cards()).getByRole("button", { name: "Show all households" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(cards()).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
    expect(within(cards()).queryByRole("listbox")).not.toBeInTheDocument();
    expect(exampleItem("A graduate on £35,000")).toHaveAttribute("aria-pressed", "false");
    applyExample("A graduate on £35,000");
    expect(isChosen(exampleItem("A graduate on £35,000"))).toBe(true);
    expect(within(cards()).getByRole("listbox", { name: "Households" })).toBeInTheDocument();
  });

  it("closes the form when an example card is chosen", () => {
    renderForm();
    expect(formIsOpen()).toBe(true);
    applyExample("A driver with a long commute");
    expect(formIsOpen()).toBe(false);
  });

  it("fills the household answers from each example", () => {
    const cases = [
      ["A 22-year-old renting", { plan: "No loan", rent: 900 }],
      ["A 19-year-old apprentice", { plan: "No loan", rent: 600 }],
      ["A graduate on £35,000", { plan: "Plan 2", rent: REGIONAL_RENT.NORTH_WEST }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = renderForm();
      // Start from answers the example must overwrite
      choose("Partner", "Yes");
      choose("Children", "2");
      applyExample(label);
      expect(regionShown()).toMatch(/^North West/);
      expect(chosen("Housing")).toBe("Rent privately");
      expect(box("Rent")).toHaveValue(expected.rent);
      expect(chosen("Partner")).toBe("No");
      expect(chosen("Children")).toBe("0");
      openMore();
      expect(chosen("Student loan plan")).toBe(expected.plan);
      unmount();
    }
  });

  it("keeps More details open across a remount in the session", () => {
    const { unmount } = renderForm();
    openMore();
    unmount();
    renderForm();
    expect(moreToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows More details' boxes when opened, focusable, in a container no utility class hides", () => {
    renderForm();
    openMore();
    for (const name of ["Savings interest", "Petrol"]) {
      const input = box(name);
      expect(input).toBeVisible();
      input.focus();
      expect(document.activeElement).toBe(input);
    }
    const credit = select("Universal Credit");
    expect(credit).toBeVisible();
    credit.focus();
    expect(document.activeElement).toBe(credit);
    // Tailwind's "collapse" utility is visibility: collapse: the expander
    // must never carry that class
    const panel = document.getElementById(moreToggle().getAttribute("aria-controls"));
    expect(panel).not.toHaveClass("collapse");
    expect(panel.querySelector(".collapse")).toBeNull();
  });
});
