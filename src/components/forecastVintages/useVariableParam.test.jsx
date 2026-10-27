/**
 * The measure in the address (?variable=): properties over any run of
 * choosing a measure, hiding the view and showing it again, on its own and
 * as the sub-tab of a view whose sub-tab is in ?sub= (useSubTabParam).
 */
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { VARIABLE_PARAM, useVariableParam } from "./useVariableParam";
import { useSubTabParam } from "../SubTabs";

const VALUES = ["rhdi_per_person", "psnb", "cpi", "real_gdp"];
const param = (name) => new URLSearchParams(window.location.search).get(name);

afterEach(cleanup);

const stepArb = fc.oneof(
  fc.record({ kind: fc.constant("choose"), value: fc.constantFrom(...VALUES) }),
  fc.record({ kind: fc.constant("hide") }),
  fc.record({ kind: fc.constant("show") }),
);

describe("the measure in the address", () => {
  it("is written only while shown and not the default, matches the measure shown, and never touches ?sub=", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom(...VALUES, "nonsense"), { nil: null }),
        fc.array(stepArb, { maxLength: 12 }),
        (start, steps) => {
          cleanup();
          window.history.replaceState({}, "", `/?tab=outlook&sub=vintages${start ? `&${VARIABLE_PARAM}=${start}` : ""}`);
          let active = true;
          const { result, rerender } = renderHook(({ on }) => useVariableParam(VALUES, on), {
            initialProps: { on: true },
          });
          const check = () => {
            const [value] = result.current;
            expect(VALUES).toContain(value);
            expect(param("sub")).toBe("vintages");
            expect(param("tab")).toBe("outlook");
            expect(param(VARIABLE_PARAM)).toBe(active && value !== VALUES[0] ? value : null);
          };
          expect(result.current[0]).toBe(VALUES.includes(start) ? start : VALUES[0]);
          check();
          for (const step of steps) {
            if (step.kind === "choose") act(() => result.current[1](step.value));
            else {
              active = step.kind === "show";
              rerender({ on: active });
            }
            check();
          }
        },
      ),
    );
  });

  it("keeps the measure left open across a hide and show", () => {
    window.history.replaceState({}, "", "/?tab=outlook&sub=vintages");
    const { result, rerender } = renderHook(({ on }) => useVariableParam(VALUES, on), { initialProps: { on: true } });
    act(() => result.current[1]("psnb"));
    rerender({ on: false });
    expect(param(VARIABLE_PARAM)).toBeNull();
    rerender({ on: true });
    expect(result.current[0]).toBe("psnb");
    expect(param(VARIABLE_PARAM)).toBe("psnb");
  });
});

describe("as the sub-tab of a view with its own ?sub=", () => {
  // A holding view like Pre-measures forecast: its sub-tab in ?sub=, this
  // view's measure in ?variable= while its sub-tab is the one shown
  const SUBS = ["baseline", "forecast", "vintages"];
  const held = {};
  function Holder({ active }) {
    const [sub, setSub] = useSubTabParam(SUBS, active);
    const [variable, setVariable] = useVariableParam(VALUES, active && sub === "vintages");
    Object.assign(held, { sub, setSub, variable, setVariable });
    return null;
  }
  // App.jsx takes ?sub= out of the address when another view is chosen
  const leave = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "methodology");
    params.delete("sub");
    window.history.replaceState({}, "", `/?${params}`);
  };

  const holderStepArb = fc.oneof(
    fc.record({ kind: fc.constant("sub"), value: fc.constantFrom(...SUBS) }),
    fc.record({ kind: fc.constant("choose"), value: fc.constantFrom(...VALUES) }),
    fc.record({ kind: fc.constant("leave") }),
    fc.record({ kind: fc.constant("return") }),
    // A link to the holding view, followed while it is hidden
    fc.record({
      kind: fc.constant("link"),
      sub: fc.option(fc.constantFrom(...SUBS, "nonsense"), { nil: null }),
      variable: fc.option(fc.constantFrom(...VALUES, "nonsense"), { nil: null }),
    }),
  );

  it("keeps each view's parameter to itself, through any run of choosing, leaving, returning and links", () => {
    fc.assert(
      fc.property(fc.array(holderStepArb, { maxLength: 14 }), (steps) => {
        cleanup();
        window.history.replaceState({}, "", "/?tab=outlook");
        let active = true;
        const { rerender } = render(<Holder active />);
        const check = () => {
          const { sub, variable } = held;
          expect(SUBS).toContain(sub);
          expect(VALUES).toContain(variable);
          if (active) expect(param("sub")).toBe(sub === SUBS[0] ? null : sub);
          else expect(param("sub")).toBeNull();
          const shown = active && sub === "vintages";
          expect(param(VARIABLE_PARAM)).toBe(shown && variable !== VALUES[0] ? variable : null);
        };
        check();
        for (const step of steps) {
          if (step.kind === "sub") act(() => held.setSub(step.value));
          else if (step.kind === "choose") act(() => held.setVariable(step.value));
          else if (step.kind === "leave") {
            if (!active) continue;
            leave();
            active = false;
            rerender(<Holder active={false} />);
          } else if (step.kind === "return") {
            if (active) continue;
            window.history.replaceState({}, "", "/?tab=outlook");
            active = true;
            rerender(<Holder active />);
          } else {
            if (active) continue;
            const params = new URLSearchParams({ tab: "outlook" });
            if (step.sub) params.set("sub", step.sub);
            if (step.variable) params.set(VARIABLE_PARAM, step.variable);
            const before = { ...held };
            window.history.replaceState({}, "", `/?${params}`);
            active = true;
            rerender(<Holder active />);
            // The link opens what it names where the view has it, and
            // otherwise leaves what was open
            expect(held.sub).toBe(SUBS.includes(step.sub) ? step.sub : before.sub);
            if (held.sub === "vintages") {
              expect(held.variable).toBe(VALUES.includes(step.variable) ? step.variable : before.variable);
            }
          }
          check();
        }
      }),
    );
  });
});
