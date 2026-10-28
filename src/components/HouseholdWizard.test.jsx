import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdCalculator, { FORM_GROUPS, WIZARD_DEFAULTS, resetSavedWizard } from "./HouseholdCalculator";
import { DEFAULT_SALARY, DEFAULT_SPENDING, REGIONAL_RENT } from "../utils/householdDefaults";
import { parseAmount } from "./personal/FormControls";
import { buildHouseholdRequest } from "../utils/householdImpactApi";

beforeEach(() => {
  resetSavedWizard();
});

/** A question's box, by the field it asks (null when not asked). */
const field = (id) => document.querySelector(`[data-row="${id}"]`);
/** The questions shown, in order. */
const fields = () => [...document.querySelectorAll(".household-field")].map((row) => row.dataset.row);
/** The steps after You and Household, each closed at first. */
const DETAIL_GROUPS = ["Spending", "Savings and other income", "Council Tax", "Benefits and loans", "Pensions and student loan"];
/** A numbered step's heading button, by its title ("Step 4: Savings and other income"). */
const groupToggle = (title) => screen.getByRole("button", { name: new RegExp(`^Step \\d+: ${title}$`) });
/** A closed step's one line: the answers that differ from the typical ones. */
const stepLine = (title) => groupToggle(title).closest(".household-step").querySelector(".household-step-summary")?.textContent ?? "";
/** Open every step, and every step's "Other questions". */
const openMore = () => {
  for (const toggle of document.querySelectorAll(".household-step-toggle")) {
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  }
  for (const toggle of document.querySelectorAll(".household-step-optional-toggle")) {
    if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  }
};
const select = (name) => screen.getByRole("combobox", { name });
const radios = (name) => screen.queryByRole("radiogroup", { name });
/** Choose an option of a select, or of a segmented choice, by its text. */
const choose = (name, option) => {
  const group = radios(name);
  if (group) {
    fireEvent.click(within(group).getByRole("radio", { name: option }));
    return;
  }
  const box = select(name);
  fireEvent.change(box, { target: { value: within(box).getByRole("option", { name: option }).value } });
};
/** A select's or a segmented choice's chosen option, as shown. */
const chosen = (name) => {
  const group = radios(name);
  if (group) return within(group).getAllByRole("radio").find((radio) => radio.checked)?.closest("label").textContent;
  const box = select(name);
  return box.options[box.selectedIndex].textContent;
};
/** A number's box: ages are spin buttons, amounts text boxes ("34,200"). */
const box = (name) => screen.queryByRole("spinbutton", { name }) ?? screen.getByRole("textbox", { name });
/** The number a box holds. */
const value = (name) => {
  const input = box(name);
  return input.type === "number" ? Number(input.value) : parseAmount(input.value);
};
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
  // A chip's name starts with its short text and ends with the full one
  const name = new RegExp(`(^|: )${label}`);
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
  it("is one card of seven numbered steps, You and Household open, with the results below it", () => {
    renderForm(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    // No steps and no "See results"; no results box before Calculate (the
    // cards say what to do)
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Results" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Choose an example/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your household" })).toBeInTheDocument();
    // Seven numbered steps and nothing after them: no More details block
    expect(screen.queryByRole("region", { name: "More details" })).toBeNull();
    expect(document.querySelector(".household-more")).toBeNull();
    expect([...document.querySelectorAll(".household-step-title")].map((heading) => heading.textContent)).toEqual([
      "Step 1: You",
      "Step 2: Household",
      "Step 3: Spending",
      "Step 4: Savings and other income",
      "Step 5: Council Tax",
      "Step 6: Benefits and loans",
      "Step 7: Pensions and student loan",
    ]);
    expect(FORM_GROUPS).toHaveLength(7);
    // After You and Household, each closed at first; with every answer
    // typical, its line is its hint, not a list of defaults
    for (const title of DETAIL_GROUPS) {
      expect(groupToggle(title)).toHaveAttribute("aria-expanded", "false");
      expect(stepLine(title)).toBe("");
    }
    const essentials = ["current_age", "current_salary", "region", "has_partner", "children_count", "tenure", "rent_from", "monthly_rent"];
    expect(fields()).toEqual(essentials);
    openMore();
    const spending = groupToggle("Spending");
    expect(spending).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(spending.getAttribute("aria-controls"))).toBeVisible();
    // No policy selected reads anything: each step shows all its answers
    expect(document.querySelector(".household-step-optional-toggle")).toBeNull();
    expect(fields()).toEqual([
      ...essentials,
      "petrol_spending_per_year",
      "diesel_spending_per_year",
      "electricity_spending_per_year",
      "savings_interest_per_year",
      "dividends_per_year",
      "property_income_per_year",
      "self_employment_receipts_per_year",
      "self_employment_expenses_per_year",
      "council_tax_band",
      "claims_universal_credit",
      // The hours of care only once "Yes" to caring
      "is_carer",
      "private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
    ]);
    expect(value("Age")).toBe(30);
    expect(seatBox()).toHaveValue("");
    expect(regionShown()).toBe("North West, until you pick a constituency");
    expect(chosen("Partner")).toBe("No");
    expect(chosen("Housing")).toBe("Rent");
    expect(chosen("Rent from")).toBe("Private landlord");
    expect(value("Rent")).toBe(REGIONAL_RENT.NORTH_WEST);
    expect(chosen("Council tax band")).toBe("D");
    fireEvent.click(spending);
    expect(spending).toHaveAttribute("aria-expanded", "false");
  });

  it("says a closed step's changed answers only, in one short line", () => {
    renderForm();
    openMore();
    fireEvent.change(box("Petrol"), { target: { value: "1,200" } });
    fireEvent.change(box("Dividends"), { target: { value: "2k" } });
    fireEvent.change(box("Self-employment or side income"), { target: { value: "3,000" } });
    choose("Council tax band", "B");
    choose("Carer", "Yes");
    choose("Student loan plan", "Plan 2");
    for (const title of DETAIL_GROUPS) fireEvent.click(groupToggle(title));
    expect(stepLine("Spending")).toBe("Petrol £1,200 a year");
    expect(stepLine("Savings and other income")).toBe("Dividends £2,000 a year · Self-employment or side income £3,000 a year");
    expect(stepLine("Council Tax")).toBe("Band B");
    expect(stepLine("Benefits and loans")).toBe("Carer, 35 hours a week");
    expect(stepLine("Pensions and student loan")).toBe("Plan 2 student loan");
    expect(groupToggle("Spending")).toHaveAccessibleDescription("Petrol £1,200 a year");
  });

  it("asks housing as rent, mortgage or own outright, and a renter's landlord beside the rent", () => {
    renderForm();
    choose("Rent from", "Council");
    expect(chosen("Housing")).toBe("Rent");
    choose("Housing", "Mortgage");
    expect(field("rent_from")).toBeNull();
    expect(field("monthly_rent")).toBeNull();
    // Back to renting: a private landlord, the first choice
    choose("Housing", "Rent");
    expect(chosen("Rent from")).toBe("Private landlord");
    choose("Rent from", "Housing association");
    choose("Children", "3");
    expect(chosen("Children")).toBe("3");
    expect(screen.getByRole("radiogroup", { name: "Partner" })).toHaveAccessibleDescription(/assessed per couple/);
  });

  it("changes an answer in its box: steppers for ages, plain boxes with separators for amounts", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Age: 1 more" }));
    expect(value("Age")).toBe(31);
    expect(screen.queryByRole("button", { name: /^Salary in 2026: £/ })).toBeNull();
    pickSeat("Holborn and St Pancras");
    expect(seatBox()).toHaveValue("Holborn and St Pancras");
    expect(regionShown()).toBe("London");
    // The rent follows the region until it is changed
    expect(value("Rent")).toBe(REGIONAL_RENT.LONDON);
    fireEvent.change(box("Rent"), { target: { value: "2,150" } });
    expect(value("Rent")).toBe(2150);
    fireEvent.click(screen.getByRole("button", { name: "Use the regional average" }));
    expect(value("Rent")).toBe(REGIONAL_RENT.LONDON);
    fireEvent.change(box("Salary in 2026"), { target: { value: "52000" } });
    expect(value("Salary in 2026")).toBe(52000);
    // Shown with its thousands separator out of the box; "45k" is taken
    expect(box("Salary in 2026")).toHaveValue("52,000");
    fireEvent.focus(box("Salary in 2026"));
    fireEvent.change(box("Salary in 2026"), { target: { value: "45k" } });
    fireEvent.blur(box("Salary in 2026"));
    expect(box("Salary in 2026")).toHaveValue("45,000");
  });

  it("starts every answer at its default, with the sources said", () => {
    renderForm();
    expect(value("Salary in 2026")).toBe(DEFAULT_SALARY);
    expect(screen.getByText(/UK median salary in April 2026 \(Source: ONS Annual Survey of Hours and Earnings/)).toBeInTheDocument();
    expect(value("Rent")).toBe(REGIONAL_RENT.NORTH_WEST);
    expect(screen.getByText(/average private rent in North West \(Source: ONS, September 2026\)/)).toBeInTheDocument();
    // A long note is the box's description, behind the info icon by its label
    expect(box("Rent")).toHaveAccessibleDescription(/average private rent in North West/);
    expect(screen.getByRole("button", { name: "About Rent" })).toBeInTheDocument();
    openMore();
    expect(chosen("Student loan plan")).toBe("No loan");
    expect(value("Petrol")).toBe(DEFAULT_SPENDING.petrol);
    // The form's info icons are the dashboard's one InfoTip: lucide's Info,
    // its note in the shared white tip card, opened on focus or a tap
    const petrolInfo = screen.getByRole("button", { name: "About Electricity" });
    expect(petrolInfo).toHaveClass("info-tip");
    expect(petrolInfo.querySelector("svg.lucide-info")).not.toBeNull();
    expect(petrolInfo).not.toHaveTextContent("i");
    expect(box("Electricity")).toHaveAccessibleDescription(/average household's spending, £20.00 a week \(Source: ONS Family Spending, 2024-25\)/);
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(petrolInfo);
    expect(screen.getByRole("tooltip")).toHaveClass("tip");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Including VAT. Prefilled with the average household's spending, £20.00 a week (Source: ONS Family Spending, 2024-25).");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.querySelector(".info-icon, .info-icon-wrapper, .info-tooltip")).toBeNull();
    expect(value("Diesel")).toBe(DEFAULT_SPENDING.diesel);
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
    expect(field("rent_from")).toBeNull();
    expect(field("partner_salary")).toBeNull();
    choose("Partner", "Yes");
    expect(value("Partner's age")).toBe(30);
    expect(value("Partner's salary in 2026")).toBe(DEFAULT_SALARY);
    openMore();
    expect(field("partner_private_pension_per_year")).not.toBeNull();
  });

  it("asks one age per child, their education from 16, and childcare only with children", () => {
    renderForm();
    openMore();
    expect(field("monthly_childcare")).toBeNull();
    choose("Children", "2");
    expect(chosen("Children")).toBe("2");
    expect(value("Child 1's age")).toBe(5);
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
    expect(value("Child 1's age")).toBe(19);
    expect(screen.getByRole("alert")).toHaveTextContent("21 was changed to 19.");
  });

  it("asks private pensions, the partner's only with a partner, and hides the Council Tax band in Northern Ireland", () => {
    renderForm();
    openMore();
    expect(value("Private or workplace pension")).toBe(0);
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
    expect(value("Your State Pension")).toBe(13817);
    expect(screen.getByText(/Prefilled with the full new State Pension for 2029-30 \(£13,817\)/)).toBeInTheDocument();
    fireEvent.change(box("Your State Pension"), { target: { value: "9000" } });
    expect(value("Your State Pension")).toBe(9000);
  });

  it("shows Your household first, then eight example cards, each a name, who they are and its measure", () => {
    render(<HouseholdCalculator />);
    const buttons = within(cards()).getAllByRole("button");
    // Each example card is a box with one button (its name) over it
    const card = (button) => button.closest(".household-card") ?? button;
    // One section heading, the page's own (as on every tab), and no other
    expect(within(cards()).getByRole("heading", { level: 2, name: "Choose a household" }).closest(".section-heading")).toHaveTextContent(
      "Enter your own household, or start from an example below.",
    );
    expect(within(cards()).getAllByRole("heading")).toHaveLength(1);
    expect(within(cards()).getByRole("group", { name: "Example households" })).toBeInTheDocument();
    expect(buttons.map((item) => item.querySelector(".household-card-name").textContent)).toEqual([
      "Your household",
      "A pensioner with a small private pension",
      "A pensioner on the full State Pension",
      "A carer working part time",
      "A driver with a long commute",
      "A family with high electricity use",
      "A landlord with savings",
      "A middle earner who lets a flat",
      "A lone parent working part time",
    ]);
    const examples = buttons.slice(1);
    expect(examples.every((item) => card(item).querySelector(".household-card-description").textContent.length > 0)).toBe(true);
    // No catalogue here: no example features a measure it does not publish
    // (#185 on #104), so no tag
    expect(examples.every((item) => card(item).querySelector(".household-card-tag") === null)).toBe(true);
    // Your household: its title, one line and the call to action, no hints
    expect(yoursCard()).not.toHaveTextContent("Salary");
    expect(yoursCard()).toHaveTextContent("Enter your household");
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

  it("scrolls to the form when Your household opens it, its first box focused", async () => {
    // The page's scroll (utils/pageScroll): the form's top, 16px below the bars
    const scrollTo = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<HouseholdCalculator />);
      const form = () => screen.queryByRole("form", { name: "Your household" });
      const rect = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
        return this === form() ? { top: 900, bottom: 1400, height: 500 } : rect.call(this);
      });
      fireEvent.click(yoursCard());
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 900 - 16 });
      expect(document.activeElement).toBe(box("Age"));
    } finally {
      window.scrollTo = original;
      vi.restoreAllMocks();
    }
  });

  it("scrolls an example to its result's heading, not to the Edit these answers line above it (phone check)", async () => {
    const scrollTo = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollTo;
    try {
      render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
      const rect = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
        if (this.classList?.contains("household-example-summary")) return { top: 700, bottom: 820, height: 120 };
        if (this.classList?.contains("household-results")) return { top: 840, bottom: 2000, height: 1160 };
        return rect.call(this);
      });
      applyExample("A carer working part time");
      await waitFor(() => expect(scrollTo).toHaveBeenCalled());
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 840 - 16 });
      // Focus goes to the result
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "Results" }));
    } finally {
      window.scrollTo = original;
      vi.restoreAllMocks();
    }
  });

  it("Edit these answers opens Your household from the example, and Reset answers goes back to the typical ones (HH10, HH12)", () => {
    render(<HouseholdCalculator />);
    applyExample("A carer working part time");
    fireEvent.click(screen.getByRole("button", { name: "Edit these answers" }));
    expect(isChosen(yoursCard())).toBe(true);
    expect(value("Age")).toBe(50);
    fireEvent.click(screen.getAllByRole("button", { name: "Reset answers" })[0]);
    expect(value("Age")).toBe(30);
    expect(document.querySelector(".household-start-from")).toBeNull();
    expect(document.querySelector(".household-example-summary")).toBeNull();
  });

  it("fills the form from an example card, still editable", () => {
    render(<HouseholdCalculator />);
    applyExample("A carer working part time");
    // Chosen: the card is marked, with one short way into its answers
    // under the cards (Pavel's review, HH10), and no description of the
    // household there (Vahid, 28 October)
    expect(isChosen(exampleItem("A carer working part time"))).toBe(true);
    expect(screen.queryByText(/Attendance Allowance/)).not.toBeInTheDocument();
    expect(document.querySelector(".household-example-summary").textContent).toBe("Edit these answers");
    // Your household, chosen from it: the example's answers, named at the
    // top of the form; the example is no longer the one chosen
    fireEvent.click(yoursCard());
    expect(isChosen(yoursCard())).toBe(true);
    expect(isChosen(exampleItem("A carer working part time"))).toBe(false);
    expect(screen.getByText("Carer", { selector: ".household-start-from strong" })).toBeInTheDocument();
    expect(value("Age")).toBe(50);
    expect(value("Salary in 2026")).toBe(12000);
    fireEvent.change(box("Salary in 2026"), { target: { value: "26000" } });
    expect(isChosen(yoursCard())).toBe(true);
    // Another example: the note goes
    applyExample("A driver with a long commute");
    expect(document.querySelector(".household-start-from")).toBeNull();
  });

  it("opens the form with an example's answers from Your household, Calculate there to change one and calculate again", () => {
    render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    applyExample("A pensioner with a small private pension");
    fireEvent.click(yoursCard());
    expect(formIsOpen()).toBe(true);
    expect(isChosen(yoursCard())).toBe(true);
    expect(isChosen(exampleItem("A pensioner with a small private pension"))).toBe(false);
    expect(screen.getByText(/Starting from:/)).toHaveTextContent("Starting from: Pensioner. Change anything, then Calculate.");
    expect(value("Age")).toBe(70);
    // Calculate is there, as for your own answers
    expect(screen.getByRole("button", { name: /^Calcul/ })).toBeVisible();
  });

  it("closes the form again from Your household once it is chosen", () => {
    render(<HouseholdCalculator selectedPolicies={["road_fuel_vat_cut"]} />);
    applyExample("A pensioner with a small private pension");
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
    applyExample("A pensioner with a small private pension");
    // Folded: the grid's cards are hidden; Your household first, then
    // eight example chips below it
    const strip = within(cards()).getByRole("listbox", { name: "Households" });
    const chips = within(strip).getAllByRole("option").slice(1);
    expect(within(strip).getAllByRole("option")).toHaveLength(9);
    expect(within(strip).getAllByRole("option")[0]).toHaveTextContent("Your household");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Pensioner",
      "Full State Pension",
      "Carer",
      "Commuter",
      "Universal Credit family",
      "Landlord",
      "Small landlord",
      "Lone parent",
    ]);
    // The full name on hover, the short one cut if it runs out of room
    expect(chips[0]).toHaveAttribute("title", "A pensioner with a small private pension");
    expect(chips[0]).toHaveAttribute("aria-selected", "true");
    expect(chips[0]).toHaveAttribute("tabindex", "0");
    expect(within(cards()).queryByRole("button", { name: /^A pensioner on the full State Pension/ })).not.toBeInTheDocument();
    expect(yoursCard()).toHaveClass("household-chip");
    expect(yoursCard()).toHaveAttribute("aria-selected", "false");
    // Another chip: switches, still folded
    fireEvent.click(chips[2]);
    expect(isChosen(exampleItem("A carer working part time"))).toBe(true);
    expect(within(cards()).getByRole("listbox", { name: "Households" })).toBeInTheDocument();
    // The arrow keys move between chips; Enter chooses
    const carer = exampleItem("A carer working part time");
    fireEvent.keyDown(carer, { key: "ArrowRight" });
    expect(document.activeElement).toBe(exampleItem("A driver with a long commute"));
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(exampleItem("A middle earner who lets a flat"));
    fireEvent.keyDown(document.activeElement, { key: "Enter" });
    expect(isChosen(exampleItem("A middle earner who lets a flat"))).toBe(true);
    // End: the last example; Home and Enter: Your household, chosen with
    // its tick, the form open
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement).toBe(exampleItem("A lone parent working part time"));
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(document.activeElement).toBe(yoursCard());
    fireEvent.keyDown(document.activeElement, { key: "Enter" });
    expect(yoursCard()).toHaveAttribute("aria-selected", "true");
    expect(isChosen(exampleItem("A middle earner who lets a flat"))).toBe(false);
    expect(formIsOpen()).toBe(true);
    // Show all households: the grid again; a card there folds it
    const toggle = within(cards()).getByRole("button", { name: "Show all households" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(cards()).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
    expect(within(cards()).queryByRole("listbox")).not.toBeInTheDocument();
    expect(exampleItem("A carer working part time")).toHaveAttribute("aria-pressed", "false");
    applyExample("A carer working part time");
    expect(isChosen(exampleItem("A carer working part time"))).toBe(true);
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
      ["A carer working part time", { housing: "Mortgage", partner: "Yes", children: "0", caring: "Yes" }],
      ["A lone parent working part time", { housing: "Rent", rent: REGIONAL_RENT.NORTH_WEST, partner: "No", children: "1", caring: "No" }],
    ];
    for (const [label, expected] of cases) {
      resetSavedWizard();
      const { unmount } = renderForm();
      // Start from answers the example must overwrite
      choose("Partner", "Yes");
      choose("Children", "2");
      applyExample(label);
      expect(regionShown()).toMatch(/^North West/);
      expect(chosen("Housing")).toBe(expected.housing);
      if (expected.rent !== undefined) {
        expect(chosen("Rent from")).toBe("Private landlord");
        expect(value("Rent")).toBe(expected.rent);
      }
      expect(chosen("Partner")).toBe(expected.partner);
      expect(chosen("Children")).toBe(expected.children);
      openMore();
      expect(chosen("Student loan plan")).toBe("No loan");
      expect(chosen("Carer")).toBe(expected.caring);
      unmount();
    }
  });

  it("keeps opened steps open across a remount in the session", () => {
    const { unmount } = renderForm();
    fireEvent.click(groupToggle("Spending"));
    unmount();
    renderForm();
    expect(groupToggle("Spending")).toHaveAttribute("aria-expanded", "true");
    expect(groupToggle("Savings and other income")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a step's boxes when opened, focusable, in a container no utility class hides", () => {
    renderForm();
    openMore();
    for (const name of ["Savings interest", "Petrol"]) {
      const input = box(name);
      expect(input).toBeVisible();
      input.focus();
      expect(document.activeElement).toBe(input);
    }
    const credit = within(radios("Universal Credit")).getByRole("radio", { name: "Yes" });
    credit.focus();
    expect(document.activeElement).toBe(credit);
    // Tailwind's "collapse" utility is visibility: collapse: the expander
    // must never carry that class
    const panel = document.getElementById(groupToggle("Spending").getAttribute("aria-controls"));
    expect(panel).not.toHaveClass("collapse");
    expect(panel.querySelector(".collapse")).toBeNull();
  });
});

describe("the selected policies' questions", () => {
  // The Budget's eight announced measures, by id and published name (the
  // name SEVEN kept from the seven-measure package)
  const SEVEN = [
    { id: "fuel_duty_rise_deferral", name: "Fuel duty cut extended" },
    { id: "state_pension_income_tax_protection", name: "Pension Tax Allowance" },
    { id: "domestic_electricity_zero_vat", name: "Zero VAT on domestic electricity" },
    { id: "property_income_rates_up", name: "Property income tax rates up" },
    { id: "savings_income_rates_up", name: "Savings income tax rates up" },
    { id: "carers_allowance_earnings_taper", name: "Carer's Allowance earnings taper" },
    { id: "household_energy_payment_2026", name: "Household energy payment" },
    { id: "trading_allowance_raise", name: "Trading allowance raised" },
  ];
  const ALL_SEVEN = SEVEN.map((policy) => policy.id);
  const STEP_ORDER = ["you", "household", "spending", "savings", "home", "benefits", "pensions"];
  /** The numbered groups shown, by heading ("Step 1: You"). */
  const groups = () => [...document.querySelectorAll(".household-step-title")].map((heading) => heading.textContent);
  /** A numbered group, by its title. */
  const group = (title) => screen.getByRole("group", { name: new RegExp(`^Step \\d+: ${title}$`) });
  /** A group's questions, in order. */
  const asked = (title) => [...group(title).querySelectorAll(".household-field")].map((row) => row.dataset.row);
  /** The policies a group's heading names (its icons' accessible name). */
  const usedBy = (title) => within(group(title)).queryByRole("img", { name: /^Used by / })?.getAttribute("aria-label") ?? null;
  const form = (selected, props = {}) => renderForm(<HouseholdCalculator selectedPolicies={selected} policies={SEVEN} {...props} />);
  /** A numbered group's heading button. */
  const stepToggle = (title) => within(group(title)).getByRole("button", { name: new RegExp(`^Step \\d+: ${title}$`) });
  /** Open every numbered group (from Step 3 they start closed). */
  const openSteps = () => {
    for (const toggle of document.querySelectorAll(".household-step-toggle")) {
      if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
    }
  };

  /** The "Other questions" toggle in a step, if it has one. */
  const otherToggle = (title) => group(title).querySelector(".household-step-optional-toggle");
  const SEVEN_STEPS = [
    "Step 1: You",
    "Step 2: Household",
    "Step 3: Spending",
    "Step 4: Savings and other income",
    "Step 5: Council Tax",
    "Step 6: Benefits and loans",
    "Step 7: Pensions and student loan",
  ];

  it("puts the answers the selected policies read first in each step, the rest under Other questions", () => {
    form(ALL_SEVEN);
    openSteps();
    expect(groups()).toEqual(SEVEN_STEPS);
    expect(asked("You")).toEqual(["current_age", "current_salary", "region"]);
    expect(asked("Household")).toEqual(["has_partner", "children_count", "tenure", "rent_from", "monthly_rent"]);
    expect(asked("Spending")).toEqual(["petrol_spending_per_year", "diesel_spending_per_year", "electricity_spending_per_year"]);
    // In the table's order: property, savings, then the trading allowance's
    expect(asked("Savings and other income")).toEqual([
      "property_income_per_year",
      "savings_interest_per_year",
      "self_employment_receipts_per_year",
      "self_employment_expenses_per_year",
    ]);
    expect(asked("Council Tax")).toEqual(["council_tax_band"]);
    // The Carer's Allowance taper asks about caring (hours once "Yes")
    expect(asked("Benefits and loans")).toEqual(["is_carer"]);
    // No selected policy reads the pensions step's answers under State
    // Pension age: all of them, with no Other questions
    expect(asked("Pensions and student loan")).toEqual(["private_pension_per_year", "salary_sacrifice_per_year", "student_loan_plan"]);
    expect(otherToggle("Pensions and student loan")).toBeNull();
    // The rest, collapsed in their own step until opened
    expect(otherToggle("Spending")).toBeNull();
    const savingsOther = otherToggle("Savings and other income");
    expect(savingsOther).toHaveTextContent("Other questions");
    expect(savingsOther).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(savingsOther);
    expect(savingsOther).toHaveAttribute("aria-expanded", "true");
    expect(asked("Savings and other income").at(-1)).toBe("dividends_per_year");
    fireEvent.click(otherToggle("Benefits and loans"));
    expect(asked("Benefits and loans")).toEqual(["is_carer", "claims_universal_credit"]);
    // No policy icons in the headings: the chevron alone (Vahid, Budget day)
    for (const title of ["You", "Spending", "Savings and other income", "Council Tax"]) expect(usedBy(title)).toBeNull();
    // No chips between the boxes, no tab stop in a heading, no tick
    expect(document.querySelector(".policy-badge")).toBeNull();
    expect(document.querySelector(".household-step-head [tabindex]")).toBeNull();
    expect(document.querySelector(".household-form")).not.toHaveTextContent("✓");
    // The group's line says what the spending boxes start at, once
    expect(group("Spending")).toHaveTextContent("Prefilled with the average household's spending");
    expect(document.getElementById("hint-petrol_spending_per_year")).toBeNull();
    // Nothing after the seven steps, and every answer asked once
    expect(screen.queryByRole("region", { name: "More details" })).toBeNull();
    openMore();
    for (const id of fields()) expect(document.querySelectorAll(`[data-row="${id}"]`)).toHaveLength(1);
    // The tab order follows the steps: every box of a step before the next's
    const order = [...document.querySelectorAll(".household-step input, .household-step select")].map(
      (input) => input.closest(".household-step").dataset.step,
    );
    expect(order).toEqual([...order].sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b)));
  });

  it("asks the State Pension first in step 7 from State Pension age", () => {
    form(ALL_SEVEN);
    fireEvent.change(box("Age"), { target: { value: "70" } });
    expect(groups()).toEqual(SEVEN_STEPS);
    openSteps();
    expect(asked("Pensions and student loan")).toEqual(["state_pension_per_year", "private_pension_per_year"]);
    fireEvent.click(otherToggle("Pensions and student loan"));
    expect(asked("Pensions and student loan")).toEqual([
      "state_pension_per_year",
      "private_pension_per_year",
      "salary_sacrifice_per_year",
      "student_loan_plan",
    ]);
  });

  it("keeps the seven steps whatever is selected, each read first where a policy reads it", () => {
    for (const selected of [[], ["household_energy_payment_2026"], ["unknown_measure"]]) {
      const { unmount } = form(selected);
      expect(groups()).toEqual(SEVEN_STEPS);
      unmount();
      resetSavedWizard();
    }
    form(["household_energy_payment_2026"]);
    openSteps();
    expect(asked("Council Tax")).toEqual(["council_tax_band"]);
    // A step no selected policy reads: all its answers, no Other questions
    expect(asked("Benefits and loans")).toEqual(["claims_universal_credit", "is_carer"]);
    expect(otherToggle("Benefits and loans")).toBeNull();
  });

  it("opens You and Household, and closes the rest, each saying only its changed answers (Vahid, Budget day)", () => {
    form(ALL_SEVEN);
    const summary = (title) => group(title).querySelector(".household-step-summary");
    expect(stepToggle("You")).toHaveAttribute("aria-expanded", "true");
    expect(stepToggle("Household")).toHaveAttribute("aria-expanded", "true");
    for (const title of ["Spending", "Savings and other income", "Council Tax"]) {
      expect(stepToggle(title)).toHaveAttribute("aria-expanded", "false");
      // Closed: no boxes; every answer typical, so its hint, no list
      expect(group(title).querySelector(".household-field")).toBeNull();
      expect(summary(title)).toBeNull();
    }
    // Opened from its heading, by click or keyboard (a button): the boxes
    fireEvent.click(stepToggle("Spending"));
    expect(stepToggle("Spending")).toHaveAttribute("aria-expanded", "true");
    expect(group("Spending")).toHaveTextContent("Prefilled with the average household's spending");
    fireEvent.change(box("Petrol"), { target: { value: "500" } });
    fireEvent.blur(box("Petrol"));
    // Closed again: the edited answer alone
    fireEvent.click(stepToggle("Spending"));
    expect(summary("Spending")).toHaveTextContent(/^Petrol £500 a year$/);
    expect(stepToggle("Spending")).toHaveAccessibleDescription("Petrol £500 a year");
    fireEvent.click(stepToggle("Council Tax"));
    choose("Council tax band", "B");
    fireEvent.click(stepToggle("Council Tax"));
    expect(summary("Council Tax")).toHaveTextContent(/^Band B$/);
    // The answer is kept while closed
    fireEvent.click(stepToggle("Spending"));
    expect(box("Petrol")).toHaveValue("500");
    expect(document.querySelector(".household-form")).not.toHaveTextContent("✓");
  });

  it("asks about caring first for the Carer's Allowance taper, the hours only for a carer", () => {
    form(["carers_allowance_earnings_taper"]);
    expect(groups()).toEqual(SEVEN_STEPS);
    const summary = () => group("Benefits and loans").querySelector(".household-step-summary");
    // Not a carer, as every household was before the form asked: typical
    expect(summary()).toBeNull();
    fireEvent.click(stepToggle("Benefits and loans"));
    expect(asked("Benefits and loans")).toEqual(["is_carer"]);
    expect(chosen("Carer")).toBe("No");
    choose("Carer", "Yes");
    // A carer is asked their hours of care, starting at 35
    expect(asked("Benefits and loans")).toEqual(["is_carer", "care_hours_per_week"]);
    expect(value("Hours of care")).toBe(35);
    fireEvent.change(box("Hours of care"), { target: { value: "50" } });
    fireEvent.blur(box("Hours of care"));
    fireEvent.click(stepToggle("Benefits and loans"));
    expect(summary()).toHaveTextContent(/^Carer, 50 hours a week$/);
    openMore();
    expect(document.querySelectorAll('[data-row="is_carer"]')).toHaveLength(1);
  });

  it("asks self-employment receipts and expenses first for the trading allowance", () => {
    form(["trading_allowance_raise"]);
    fireEvent.click(stepToggle("Savings and other income"));
    expect(asked("Savings and other income")).toEqual(["self_employment_receipts_per_year", "self_employment_expenses_per_year"]);
    expect(value("Self-employment or side income")).toBe(0);
    fireEvent.change(box("Self-employment or side income"), { target: { value: "3,000" } });
    fireEvent.blur(box("Self-employment or side income"));
    fireEvent.click(stepToggle("Savings and other income"));
    expect(group("Savings and other income").querySelector(".household-step-summary")).toHaveTextContent(
      /^Self-employment or side income £3,000 a year$/,
    );
  });

  it("shows an example's answers in its closed steps without opening them", () => {
    form(ALL_SEVEN);
    applyExample("A landlord with savings");
    fireEvent.click(screen.getByRole("button", { name: "Edit these answers" }));
    const summary = (title) => group(title).querySelector(".household-step-summary");
    expect(stepToggle("Savings and other income")).toHaveAttribute("aria-expanded", "false");
    expect(summary("Savings and other income")).toHaveTextContent(/Savings interest £[\d,]+ a year · .*Property income £[\d,]+ a year/);
    // Reset answers: back to the typical ones, no line
    fireEvent.click(screen.getAllByRole("button", { name: "Reset answers" })[0]);
    expect(summary("Savings and other income")).toBeNull();
  });

  it("lets Calculate start a new request when the answers change while the last one runs (HH11)", async () => {
    const API = "https://api.test/api/household-impact";
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", API);
    // The household API never answers: the first request stays loading
    vi.stubGlobal("fetch", vi.fn((url) => (url === API ? new Promise(() => {}) : Promise.resolve(new Response("{}", { status: 404 })))));
    try {
      form(ALL_SEVEN, { year: 2027 });
      fireEvent.click(screen.getByRole("button", { name: /^Calculate/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /Calculating/ })).toBeDisabled());
      // Edited while it runs: Calculate is pressable again, and the results
      // area says the answers have changed rather than going blank
      fireEvent.change(box("Age"), { target: { value: "41" } });
      fireEvent.blur(box("Age"));
      await waitFor(() => expect(screen.getByRole("button", { name: /^Calculate/ })).not.toBeDisabled());
      expect(screen.getByText("Your answers have changed. Press Calculate to see the new result.")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("sends the same request for the same answers, wherever they are asked", async () => {
    const API = "https://api.test/api/household-impact";
    const bodies = [];
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", API);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        if (url === API) bodies.push(JSON.parse(init.body));
        return new Response("{}", { status: 404 });
      }),
    );
    try {
      form(ALL_SEVEN, { year: 2027 });
      openSteps();
      fireEvent.change(box("Petrol"), { target: { value: "900" } });
      fireEvent.blur(box("Petrol"));
      choose("Council tax band", "B");
      fireEvent.click(screen.getByRole("button", { name: /^Calculate/ }));
      // Your household's headline (the example cards ask for theirs too)
      const yours = () => bodies.find((body) => body.household.petrol_spending === 900 && body.include.length === 0);
      await waitFor(() => expect(yours()).toBeDefined());
      const answers = { ...WIZARD_DEFAULTS, petrol_spending_per_year: 900, council_tax_band: "B" };
      expect(yours()).toEqual(buildHouseholdRequest(answers, { year: 2027, policies: ALL_SEVEN }));
      expect(yours().household).toMatchObject({ petrol_spending: 900, council_tax_band: "B", diesel_spending: DEFAULT_SPENDING.diesel });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
