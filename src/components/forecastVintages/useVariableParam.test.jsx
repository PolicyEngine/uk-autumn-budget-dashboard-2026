/**
 * The measure in the address (?variable=): properties over any run of
 * choosing a measure, hiding the view and showing it again.
 */
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { act, cleanup, renderHook } from "@testing-library/react";
import { VARIABLE_PARAM, useVariableParam } from "./useVariableParam";

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
