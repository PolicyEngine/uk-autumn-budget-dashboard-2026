import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decileSentence, laterDecileNote, laterRevenueNote, revenueSentence } from "./plainSentences";

describe("plain card sentences", () => {
  const rows = (low, high) => [{ netChange: low }, { netChange: 0 }, { netChange: high }];

  it("says what the ends of the decile pair gain or lose, shortly", () => {
    // Same direction: the verb and the unit are said once
    expect(decileSentence(rows(18, 52), "absolute")).toBe("The lowest-income tenth gains about £20 a year and the highest about £50.");
    expect(decileSentence(rows(-18, -52), "absolute")).toBe("The lowest-income tenth loses about £20 a year and the highest about £50.");
    // Mixed directions: each end keeps its verb
    expect(decileSentence(rows(184, -312), "absolute")).toBe("The lowest-income tenth gains about £180 a year and the highest loses about £310.");
    expect(decileSentence(rows(-0.42, 0.26), "relative")).toBe("The lowest-income tenth loses 0.4% of net income and the highest gains 0.3%.");
    // One end with almost no change
    expect(decileSentence(rows(0.31, 0.01), "relative")).toBe("The lowest-income tenth gains 0.3% of net income and the highest almost nothing.");
    expect(decileSentence(rows(3, -48), "absolute")).toBe("The lowest-income tenth sees almost no change and the highest loses about £50 a year.");
    // Equal, as rounded, and no change at either end
    expect(decileSentence(rows(21, 18), "absolute")).toBe("The lowest- and highest-income tenths each gain about £20 a year.");
    expect(decileSentence(rows(-0.31, -0.29), "relative")).toBe("The lowest- and highest-income tenths each lose 0.3% of net income.");
    expect(decileSentence(rows(4, -3), "absolute")).toBe("The lowest- and highest-income tenths see almost no change.");
    expect(decileSentence([], "absolute")).toBeNull();
  });

  it("ends on the later-year turn, when there is one", () => {
    expect(decileSentence(rows(18, 52), "absolute", "in 2031-32 the highest loses")).toBe(
      "The lowest-income tenth gains about £20 a year and the highest about £50; in 2031-32 the highest loses.",
    );
    expect(decileSentence(rows(0.31, 0.01), "relative", "in 2031-32 the highest loses")).toBe(
      "The lowest-income tenth gains 0.3% of net income and the highest almost nothing; in 2031-32 the highest loses.",
    );
    expect(decileSentence(rows(18, 52), "absolute", null)).toBe("The lowest-income tenth gains about £20 a year and the highest about £50.");
  });

  it("puts the revenue for the selected year in words", () => {
    expect(revenueSentence(4.26, "2027-28")).toBe("In 2027-28, the selected policies raise £4.3 billion for the government.");
    expect(revenueSentence(-0.42, "2027-28")).toBe("In 2027-28, the selected policies cost the government £420 million.");
    expect(revenueSentence(null, "2027-28")).toBeNull();
    // A measure not in force that year changes nothing: not "roughly balance"
    expect(revenueSentence(0, "2027-28")).toBe("In 2027-28, the selected policies change no revenue.");
    expect(revenueSentence(0.02, "2027-28")).toMatch(/roughly balance/);
  });

  it("points to the first later year in which a decile end moves the other way", () => {
    const later = [
      { yearLabel: "2028-29", low: 70, high: 30 },
      { yearLabel: "2029-30", low: 20, high: -46 },
      { yearLabel: "2031-32", low: -5, high: -328 },
    ];
    expect(laterDecileNote({ low: 75, high: 45 }, later, "absolute")).toBe(
      "in 2029-30 the highest loses",
    );
    // Both ends turn the same way
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2031-32", low: -50, high: -328 }], "absolute")).toBe(
      "in 2031-32 both lose",
    );
    // Both turn, different ways
    expect(laterDecileNote({ low: -20, high: 45 }, [{ yearLabel: "2030-31", low: 30, high: -60 }], "absolute")).toBe(
      "in 2030-31 the lowest gains and the highest loses",
    );
    // Alone, with no decile sentence to end: the tenths in full
    expect(laterDecileNote({ low: -20, high: 45 }, [{ yearLabel: "2030-31", low: 30, high: -60 }], "absolute", { standalone: true })).toBe(
      "Later years differ: in 2030-31, the lowest-income tenth gains and the highest-income tenth loses.",
    );
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2031-32", low: -50, high: -328 }], "absolute", { standalone: true })).toBe(
      "Later years differ: in 2031-32, both the lowest- and highest-income tenths lose.",
    );
  });

  it("rounds as the decile sentence does, so a rounding wobble is no turn", () => {
    // 0.03% and -0.04% both read as almost no change
    expect(laterDecileNote({ low: 0.3, high: 0.03 }, [{ yearLabel: "2028-29", low: 0.05, high: -0.04 }], "relative")).toBeNull();
    // £4 and -£4 both round to £0
    expect(laterDecileNote({ low: 75, high: 4 }, [{ yearLabel: "2028-29", low: 60, high: -4 }], "absolute")).toBeNull();
    // -0.18% reads as a 0.2% loss: clear, from almost no change; the low end's fade says nothing
    expect(laterDecileNote({ low: 0.3, high: 0.03 }, [{ yearLabel: "2031-32", low: -0.02, high: -0.18 }], "relative")).toBe(
      "in 2031-32 the highest loses",
    );
  });

  it("says nothing when a measure ends, fades or creeps", () => {
    // A measure ending: a gain falls to almost no change
    expect(laterDecileNote({ low: 0.3, high: 0.2 }, [{ yearLabel: "2031-32", low: 0.3, high: 0.01 }], "relative")).toBeNull();
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: 0, high: 0 }], "absolute")).toBeNull();
    // A fade: 0.10% to 0.04%
    expect(laterDecileNote({ low: 0.1, high: 0.3 }, [{ yearLabel: "2028-29", low: 0.04, high: 0.3 }], "relative")).toBeNull();
    // A creep from about £1 to £6, and to £14 (rounds to £10, under £20)
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 6, high: 30 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 14, high: 30 }], "absolute")).toBeNull();
    // A small gain turning to a loss under the clear threshold
    expect(laterDecileNote({ low: 40, high: 30 }, [{ yearLabel: "2029-30", low: -12, high: 30 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 0.3, high: 0.3 }, [{ yearLabel: "2029-30", low: -0.1, high: 0.3 }], "relative")).toBeNull();
  });

  it("points to a clear effect from almost no change, as with the threshold freeze", () => {
    // Almost nothing in the selected year, both ends clearly lose later
    const freeze = [
      { yearLabel: "2028-29", low: -3, high: -8 },
      { yearLabel: "2029-30", low: -9, high: -14 },
      { yearLabel: "2031-32", low: -25, high: -180 },
    ];
    // Both lose clearly in 2031-32, but 2028-29's own sentence already says
    // the highest loses (about £10), and 2029-30's that both do: the
    // pointer names 2028-29, the first year whose sentence shows the turn
    expect(decileSentence(rows(-3, -8), "absolute")).toBe("The lowest-income tenth sees almost no change and the highest loses about £10 a year.");
    expect(laterDecileNote({ low: 0, high: -2 }, freeze, "absolute")).toBe(
      "in 2028-29 the highest loses",
    );
    // £15 rounds to £20: clear
    expect(laterDecileNote({ low: 1, high: 30 }, [{ yearLabel: "2029-30", low: 15, high: 30 }], "absolute")).toBe(
      "in 2029-30 the lowest gains",
    );
    expect(laterDecileNote({ low: 0.02, high: 0.01 }, [{ yearLabel: "2031-32", low: -0.2, high: -0.4 }], "relative")).toBe(
      "in 2031-32 both lose",
    );
  });

  it("names the first year whose own sentence shows the turn, once the turn is clear", () => {
    // The whole published package (seven measures, avg_change summed as
    // laterDecileEnds does): the highest-income tenth gains about £100 in
    // 2026-27, loses about £10 in 2027-28 and about £50 from 2028-29
    const pkg = [
      { yearLabel: "2027-28", low: 24, high: -12 },
      { yearLabel: "2028-29", low: 3, high: -50 },
      { yearLabel: "2029-30", low: 6, high: -51 },
    ];
    expect(decileSentence(rows(24, -12), "absolute")).toBe("The lowest-income tenth gains about £20 a year and the highest loses about £10.");
    expect(decileSentence(rows(104, 98), "absolute", laterDecileNote({ low: 104, high: 98 }, pkg, "absolute"))).toBe(
      "The lowest- and highest-income tenths each gain about £100 a year; in 2027-28 the highest loses.",
    );
    // The ends date apart: the lowest shows its gain in 2028-29, the highest
    // its loss only in 2029-30; both are clear in 2030-31. The earlier names
    // the year, alone
    const apart = [
      { yearLabel: "2027-28", low: -2, high: 3 },
      { yearLabel: "2028-29", low: 8, high: 1 },
      { yearLabel: "2029-30", low: 12, high: -9 },
      { yearLabel: "2030-31", low: 40, high: -60 },
    ];
    expect(laterDecileNote({ low: 0, high: 0 }, apart, "absolute")).toBe("in 2028-29 the lowest gains");
    // A turn that never becomes clear still says nothing, however early it shows
    expect(laterDecileNote({ low: 40, high: 30 }, [{ yearLabel: "2028-29", low: -12, high: 30 }, { yearLabel: "2029-30", low: -14, high: 30 }], "absolute")).toBeNull();
  });

  // What a decile sentence says of each end: its direction ("gain", "loss"
  // or "none") and the size it gives, read off the words alone
  const AMOUNT = String.raw`(?:about £([\d,]+)|([\d.]+)%)`;
  const NONE = { dir: "none", size: 0 };
  const verbDir = (verb) => (/^gain/.test(verb) ? "gain" : "loss");
  const size = (pounds, percent) => (pounds != null ? Number(pounds.replace(/,/g, "")) : Number(percent));
  function saysOf(sentence) {
    const first = sentence.split(";")[0].replace(/\.$/, "");
    if (first === "The lowest- and highest-income tenths see almost no change") return { low: NONE, high: NONE };
    let m = first.match(new RegExp(`^The lowest- and highest-income tenths each (gain|lose) ${AMOUNT}`));
    if (m) {
      const both = { dir: verbDir(m[1]), size: size(m[2], m[3]) };
      return { low: both, high: both };
    }
    m = first.match(new RegExp(`^The lowest-income tenth sees almost no change and the highest (gains|loses) ${AMOUNT}`));
    if (m) return { low: NONE, high: { dir: verbDir(m[1]), size: size(m[2], m[3]) } };
    m = first.match(new RegExp(`^The lowest-income tenth (gains|loses) ${AMOUNT}(?: a year| of net income) and the highest (almost nothing|(?:(gains|loses) )?${AMOUNT})$`));
    if (!m) throw new Error(`Unread sentence: ${sentence}`);
    const low = { dir: verbDir(m[1]), size: size(m[2], m[3]) };
    return { low, high: m[4] === "almost nothing" ? NONE : { dir: m[5] ? verbDir(m[5]) : low.dir, size: size(m[6], m[7]) } };
  }
  // The pointer's year and the turn it gives each end it names
  function pointerOf(clause) {
    const m = clause.match(/^in (\S+) (?:both (gain|lose)|the lowest (gains|loses)(?: and the highest (gains|loses))?|the highest (gains|loses))$/);
    if (!m) throw new Error(`Unread pointer: ${clause}`);
    if (m[2]) return { year: m[1], turns: { low: verbDir(m[2]), high: verbDir(m[2]) } };
    const turns = {};
    if (m[3]) turns.low = verbDir(m[3]);
    if (m[4] ?? m[5]) turns.high = verbDir(m[4] ?? m[5]);
    return { year: m[1], turns };
  }
  const LABELS = ["2027-28", "2028-29", "2029-30", "2030-31", "2031-32", "2032-33"];
  const series = (value) =>
    fc.tuple(fc.record({ low: value, high: value }), fc.array(fc.record({ low: value, high: value }), { maxLength: LABELS.length })).map(([selected, later]) => ({
      selected,
      later: later.map((ends, index) => ({ yearLabel: LABELS[index], ...ends })),
    }));
  const VALUES = {
    // Mostly near the rounding and clear steps, sometimes large
    absolute: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: -60, max: 60 }) }, { weight: 1, arbitrary: fc.integer({ min: -400, max: 400 }) }),
    relative: fc.integer({ min: -50, max: 50 }).map((n) => n / 100),
  };

  for (const kind of ["absolute", "relative"]) {
    it(`never names a later year than one whose own sentence already shows the turn (${kind})`, () => {
      const clear = { absolute: 20, relative: 0.2 }[kind];
      fc.assert(
        fc.property(series(VALUES[kind]), ({ selected, later }) => {
          const said = (ends) => saysOf(decileSentence(rows(ends.low, ends.high), kind));
          const was = said(selected);
          const years = later.map((ends) => ({ yearLabel: ends.yearLabel, says: said(ends) }));
          // A clear turn, as the sentences put it: a direction other than the
          // selected year's, at least the clear size
          const clearTurn = (now, before) => now.dir !== "none" && now.dir !== before.dir && now.size >= clear - 1e-9;
          const note = laterDecileNote(selected, later, kind);
          // There is a pointer exactly when some later year turns clearly
          expect(note !== null).toBe(years.some(({ says }) => clearTurn(says.low, was.low) || clearTurn(says.high, was.high)));
          if (note === null) return;
          expect(decileSentence(rows(selected.low, selected.high), kind, note)).toMatch(/; in \S+ .+\.$/);
          const { year, turns } = pointerOf(note);
          const at = years.findIndex(({ yearLabel }) => yearLabel === year);
          expect(at).toBeGreaterThanOrEqual(0);
          expect(Object.keys(turns).length).toBeGreaterThan(0);
          for (const [end, dir] of Object.entries(turns)) {
            // A turn from the selected year, which the named year's own
            // sentence says and no earlier later year's does
            expect(dir).not.toBe(was[end].dir);
            expect(years[at].says[end].dir).toBe(dir);
            for (const { says } of years.slice(0, at)) expect(says[end].dir).not.toBe(dir);
            // and which becomes clear by some year
            expect(years.slice(at).some(({ says }) => says[end].dir === dir && clearTurn(says[end], was[end]))).toBe(true);
          }
          // The standalone sentence names the same year
          expect(laterDecileNote(selected, later, kind, { standalone: true })).toMatch(new RegExp(`^Later years differ: in ${year}, `));
        }),
        { numRuns: 2000 },
      );
    });
  }

  it("never names a later revenue year than one whose own sentence already shows the turn", () => {
    const net = fc.oneof(fc.integer({ min: -30, max: 30 }).map((n) => n / 100), fc.integer({ min: -100, max: 100 }).map((n) => n / 10));
    const says = (sentence) => (/change no revenue|roughly balance/.test(sentence) ? "none" : /raise/.test(sentence) ? "gain" : "loss");
    fc.assert(
      fc.property(net, fc.array(net, { maxLength: LABELS.length }), (selected, values) => {
        const later = values.map((value, index) => ({ yearLabel: LABELS[index], net: value }));
        const was = says(revenueSentence(selected, "2026-27"));
        const years = later.map(({ yearLabel, net: value }) => ({ yearLabel, value, says: says(revenueSentence(value, yearLabel)) }));
        // A clear turn: a direction other than the selected year's, by at least £0.1bn
        const clearTurn = ({ value, says: now }) => now !== "none" && now !== was && Math.abs(value) >= 0.1 - 1e-9;
        const note = laterRevenueNote(selected, later);
        expect(note !== null).toBe(years.some(clearTurn));
        if (note === null) return;
        const m = note.match(/^Later years differ: in (\S+), the selected policies (raise|cost) revenue\.$/);
        expect(m).not.toBeNull();
        const dir = m[2] === "raise" ? "gain" : "loss";
        const at = years.findIndex(({ yearLabel }) => yearLabel === m[1]);
        expect(dir).not.toBe(was);
        expect(years[at].says).toBe(dir);
        for (const year of years.slice(0, at)) expect(year.says).not.toBe(dir);
        expect(years.slice(at).some((year) => year.says === dir && clearTurn(year))).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("says nothing without a turn, or without the selected year's ends", () => {
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: 10, high: 20 }], "absolute")).toBeNull();
    expect(laterDecileNote({ low: 75, high: 45 }, [], "absolute")).toBeNull();
    expect(laterDecileNote({ low: null, high: 45 }, [{ yearLabel: "2028-29", low: -10, high: -20 }], "absolute")).toBeNull();
    expect(laterDecileNote(null, [{ yearLabel: "2028-29", low: -10, high: -20 }], "absolute")).toBeNull();
    // A later year without both ends is skipped, not read as a turn
    expect(laterDecileNote({ low: 75, high: 45 }, [{ yearLabel: "2028-29", low: null, high: -20 }], "absolute")).toBeNull();
  });

  it("points to the first later year in which the revenue turns", () => {
    const later = [
      { yearLabel: "2028-29", net: -6.9 },
      { yearLabel: "2029-30", net: null },
      { yearLabel: "2030-31", net: 3.2 },
    ];
    expect(laterRevenueNote(-8.9, later)).toBe("Later years differ: in 2030-31, the selected policies raise revenue.");
    expect(laterRevenueNote(4.3, [{ yearLabel: "2031-32", net: -1.2 }])).toBe(
      "Later years differ: in 2031-32, the selected policies cost revenue.",
    );
    // From roughly balancing to a clear effect (at least £0.1bn) by 2031-32,
    // named from 2029-30, whose own sentence already says they raise £60m
    expect(revenueSentence(0.06, "2029-30")).toBe("In 2029-30, the selected policies raise £60 million for the government.");
    expect(laterRevenueNote(0.02, [{ yearLabel: "2029-30", net: 0.06 }, { yearLabel: "2031-32", net: 3.77 }])).toBe(
      "Later years differ: in 2029-30, the selected policies raise revenue.",
    );
    expect(laterRevenueNote(-0.01, [{ yearLabel: "2031-32", net: -0.1 }])).toBe(
      "Later years differ: in 2031-32, the selected policies cost revenue.",
    );
  });

  it("says nothing when the revenue effect ends, fades or turns by less than £0.1bn", () => {
    // A cost ending
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0.02 }])).toBeNull();
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0 }])).toBeNull();
    // A fade
    expect(laterRevenueNote(1.4, [{ yearLabel: "2031-32", net: 0.3 }])).toBeNull();
    // A small turn, and a creep out of the balance band
    expect(laterRevenueNote(-2, [{ yearLabel: "2031-32", net: 0.08 }])).toBeNull();
    expect(laterRevenueNote(0.01, [{ yearLabel: "2031-32", net: 0.07 }])).toBeNull();
    expect(laterRevenueNote(-8.9, [{ yearLabel: "2028-29", net: -3.8 }])).toBeNull();
    expect(laterRevenueNote(null, [{ yearLabel: "2030-31", net: 3.2 }])).toBeNull();
  });
});

describe("the revenue sentence's rounding", () => {
  it("rounds as the chart's labels and tooltip do (£m to the nearest £5m, £bn to one decimal)", async () => {
    const { revenueSentence } = await import("./plainSentences");
    const { formatBnOrM } = await import("./moneyFormat");
    expect(revenueSentence(-0.6172, "2027-28")).toBe("In 2027-28, the selected policies cost the government £615 million.");
    expect(formatBnOrM(-0.6172)).toBe("−£615m");
    expect(revenueSentence(2.36, "2028-29")).toBe("In 2028-29, the selected policies raise £2.4 billion for the government.");
  });
});
