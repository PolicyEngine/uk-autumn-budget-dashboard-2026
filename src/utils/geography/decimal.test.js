import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  absDecimal,
  canonicalDecimal,
  compareDecimal,
  groupThousands,
  isDecimal,
  parseDecimal,
  shiftDecimal,
  signOf,
} from "./decimal";

describe("decimal strings", () => {
  it("accepts plain and e-notation decimals, and nothing else", () => {
    for (const text of ["0", "-0", "120.0", "-0.005", ".5", "5.", "1e-05", "1.2E+03"]) {
      expect(isDecimal(text), text).toBe(true);
    }
    for (const text of ["", " ", "-", ".", "e5", "1e", "1,000", "NaN", "inf", "0x10", " 1", "1 ", "1e100"]) {
      expect(isDecimal(text), text).toBe(false);
    }
    expect(() => parseDecimal("abc")).toThrow();
  });

  it("keeps exactly the published digits", () => {
    expect(canonicalDecimal("120.0")).toBe("120");
    expect(canonicalDecimal("0.0010")).toBe("0.001");
    expect(canonicalDecimal("-0.50")).toBe("-0.5");
    expect(canonicalDecimal("-0.0")).toBe("0");
    expect(canonicalDecimal("1e-05")).toBe("0.00001");
    expect(canonicalDecimal("1.25e2")).toBe("125");
    expect(canonicalDecimal("00012.3400")).toBe("12.34");
  });

  it("moves the decimal point without floating-point digits", () => {
    expect(shiftDecimal("0.0123", 2)).toBe("1.23");
    expect(shiftDecimal("0.01", 2)).toBe("1");
    expect(shiftDecimal("0.07", 2)).toBe("7");
    expect(shiftDecimal("-0.005", 2)).toBe("-0.5");
    expect(shiftDecimal("0.29", 2)).toBe("29");
    expect(shiftDecimal("0.000123", 2)).toBe("0.0123");
    expect(shiftDecimal("5e-05", 2)).toBe("0.005");
    // The float route adds digits: 0.07 * 100 is 7.000000000000001.
    expect(String(0.07 * 100)).not.toBe("7");
  });

  it("compares exactly", () => {
    expect(compareDecimal("0.001", "0.0010")).toBe(0);
    expect(compareDecimal("-0.0", "0")).toBe(0);
    expect(compareDecimal("0.0099999999999999999", "0.01")).toBe(-1);
    expect(compareDecimal("-10", "-9.99")).toBe(-1);
    expect(compareDecimal("1e-3", "0.001")).toBe(0);
    expect(compareDecimal("100", "99.5")).toBe(1);
  });

  it("orders like the numbers they write", () => {
    const decimal = fc
      .tuple(fc.integer({ min: -1e6, max: 1e6 }), fc.integer({ min: 0, max: 6 }))
      .map(([units, places]) => (units / 10 ** places).toFixed(places));
    fc.assert(
      fc.property(decimal, decimal, (a, b) => {
        const expected = Math.sign(Number(a) - Number(b));
        expect(compareDecimal(a, b)).toBe(expected === 0 ? 0 : expected);
      }),
    );
  });

  it("reads signs and magnitudes", () => {
    expect(signOf("-0.0")).toBe(0);
    expect(signOf("-0.001")).toBe(-1);
    expect(signOf("3")).toBe(1);
    expect(absDecimal("-1234.50")).toBe("1234.5");
  });

  it("groups thousands the en-GB way", () => {
    expect(groupThousands("1234567.891")).toBe("1,234,567.891");
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("1000")).toBe("1,000");
  });
});
