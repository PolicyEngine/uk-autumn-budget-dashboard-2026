"""The Budget-day PDF report, built from the published manifest and its artifacts.

Reads ``<data>/manifest.json`` and the artifacts it names (never the flat
CSVs beside it), shows only displayable entries (approved or provisional),
and uses the combined run only when it covers exactly the displayed measures
with their current outputs, as the dashboard does (``src/utils/publication/
select.js``). Every figure printed is written to ``figures.json`` with the
file, row and column it came from; ``check`` recomputes them.

    uv run --with matplotlib==3.10.1 --with playwright==1.52.0 \\
        python -I report/build_report.py build --data public/data --out build/report --pdf

    uv run python -I report/build_report.py check build/report/figures.json --data public/data

Nothing here writes under ``public/``, runs a simulation or changes a figure.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import html
import io
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CONTRACT = REPO / "src" / "utils" / "publication" / "contract.json"
MANIFEST_SCHEMA = "uk-budget-dashboard/publication-manifest/v1"

# The dashboard's choices, mirrored (src/utils/publication/manifest.js,
# displayYears.js, chartTheme.js, ageImpact.js).
DISPLAYABLE = ("approved", "provisional")
PROVISIONAL_LABEL = "Provisional: statement figures, awaiting Treasury costing"
CANDIDATE_PROVISIONAL_LABEL = (
    "Provisional: candidate measures modelled before the Budget, not announced policy"
)


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def is_candidate_manifest(manifest: dict) -> bool:
    """Whether the manifest's entries are pre-Budget candidates, the page's
    rule (src/utils/publication/manifest.js, isCandidateManifest).

    The forecast basis alone cannot say this: the runbook keeps it at
    pre_budget on Budget day unless the forecast is rebased. So: last written
    (updated_at, UTC) before the Budget date the manifest names (budget.date,
    from CURRENT_BUDGET), and not rebased. Without both dates, not a
    candidate: "not announced policy" is said only on evidence.
    """
    forecast = (manifest.get("basis") or {}).get("forecast") or {}
    if forecast.get("status") == "updated":
        return False
    updated = manifest.get("updated_at")
    budget_date = (manifest.get("budget") or {}).get("date")
    if not isinstance(updated, str) or not isinstance(budget_date, str):
        return False
    if not _ISO_DATE.match(updated) or not _ISO_DATE.match(budget_date):
        return False
    return updated[:10] < budget_date[:10]


DEFAULT_YEAR = 2027
COL_W = 6.85  # the text column, A4 less 18mm margins, in inches
GAIN, GAIN_TEXT = "#319795", "#0F766E"
LOSS, LOSS_TEXT = "#D97706", "#B45309"
INK, TEXT, MUTED, GRID, AXIS = "#1F2937", "#374151", "#4B5563", "#E5E7EB", "#9CA3AF"
NEUTRAL, HIGHLIGHT, ZERO = "#9CA3AF", "#285E61", "#374151"
AGE_BANDS = [
    ("0-15", "Under 16"),
    ("16-24", "16 to 24"),
    ("25-34", "25 to 34"),
    ("35-49", "35 to 49"),
    ("50-64", "50 to 64"),
    ("65+", "65 and over"),
]
DECILES = [str(i) for i in range(1, 11)]
REL_DECILES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]
WITHHELD = "withheld"
WITHHELD_NOTE = "Withheld: too few survey households."
NOT_SHOWN_REASONS = {
    "staged": "awaiting review",
    "stale": "superseded by a model or data change; awaiting a new run",
    "withdrawn": "withdrawn",
    "not_computable": "cannot be costed on the certified data",
}


def fy(year: int) -> str:
    return f"{year}-{(year + 1) % 100:02d}"


WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def count_words(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else f"{n:,}"


def long_date(text: str) -> str:
    """2026-10-28 or an ISO timestamp → 28 October 2026 (with the time, if any)."""
    try:
        when = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return text or ""
    if len(text) <= 10:
        return f"{when.day} {when:%B %Y}"
    return f"{when.day} {when:%B %Y}, {when:%H:%M} UTC"


def esc(text) -> str:
    return html.escape(str(text), quote=True)


# --- Formats ------------------------------------------------------------
# One function per kind of figure; ``check`` uses the same ones, so a figure
# is traced by its value, its source and the format that printed it.

MINUS = "−"


def _signed(value: float, body: str, plus: bool) -> str:
    if float(re.sub(r"[^0-9.]", "", body) or 0) == 0:
        return body
    if value < 0:
        return MINUS + body
    return ("+" + body) if plus else body


FORMATS = {
    # £bn with two decimals, as the dashboard's tables (formatBillions)
    "bn2": lambda v: _signed(v, f"£{abs(v):,.2f}bn", False),
    "bn2_plain": lambda v: _signed(v, f"{abs(v):,.2f}", False),
    # £bn in words, as the dashboard's revenue sentence
    "bn_words": lambda v: (
        f"£{abs(v):.1f} billion" if abs(v) >= 0.95 else f"£{round(abs(v) * 1000):,} million"
    ),
    "gbp": lambda v: _signed(v, f"£{abs(v):,.0f}", True),
    "gbp_plain": lambda v: f"£{abs(v):,.0f}",
    "pct2": lambda v: _signed(v, f"{abs(v):.2f}%", True),
    "pct1_plain": lambda v: f"{abs(v):.1f}%",
    "pct0_plain": lambda v: f"{abs(v):.0f}%",
    "pp2": lambda v: _signed(v, f"{abs(v):.2f}pp", True),
    "pp3": lambda v: _signed(v, f"{abs(v):.3f}pp", True),
    "count": lambda v: f"{v:,.0f}",
}

TRANSFORMS = {
    "value": lambda xs: xs[0],
    "x100": lambda xs: xs[0] * 100,
    "sum": lambda xs: sum(xs),
    "neg": lambda xs: -xs[0],
}


class Trace:
    """Every printed figure, with where it came from."""

    def __init__(self, data: Path):
        self.data = data
        self.items: list[dict] = []

    def fig(self, value, fmt, file, column, where, transform="value", section=""):
        text = FORMATS[fmt](value)
        self.items.append(
            {
                "section": section,
                "text": text,
                "value": value,
                "format": fmt,
                "file": str(file.relative_to(self.data)) if isinstance(file, Path) else file,
                "column": column,
                "where": where,
                "transform": transform,
            }
        )
        return text


# --- Reading the publication --------------------------------------------


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Entry:
    def __init__(self, data: Path, key: str, entry: dict, combined: bool):
        self.key = key
        self.entry = entry
        self.combined = combined
        self.status = entry["status"]
        self.name = entry.get("name") or key
        self.description = entry.get("description", "")
        self.dir = data / entry["artifact"] if entry.get("artifact") else None
        self.years = [y for y in entry.get("years", []) if y not in entry.get("unsupported_years", [])]
        self.unsupported = list(entry.get("unsupported_years", []))
        self.receipt = None
        self._tables = {}
        if self.dir is None:
            raise SystemExit(f"{key}: the manifest names no artifact")
        if not (self.dir / "receipt.json").exists():
            raise SystemExit(f"{key}: no receipt.json in {self.dir}, so its files cannot be checked")
        self.receipt = json.loads((self.dir / "receipt.json").read_text())
        self._verify_files()

    def _verify_files(self):
        """Each table must be the file the receipt names, byte for byte."""
        files = (self.receipt.get("dashboard") or {}).get("files") or {}
        for name, digest in files.items():
            path = self.dir / name
            if not path.exists():
                raise SystemExit(f"{self.key}: {name} is named in its receipt but missing ({path})")
            if sha256(path) != digest:
                raise SystemExit(f"{self.key}: {name} differs from its receipt ({path})")

    def path(self, table: str) -> Path:
        return self.dir / f"{table}.csv"

    def table(self, table: str) -> list[dict]:
        if table not in self._tables:
            path = self.path(table)
            rows = read_csv(path) if path.exists() else []
            self._tables[table] = [r for r in rows if r.get("reform_id") == self.key]
        return self._tables[table]

    def row(self, table: str, **match):
        for r in self.table(table):
            if all(str(r.get(k)) == str(v) for k, v in match.items()):
                return r
        return None


class Publication:
    def __init__(self, data: Path):
        self.data = data
        self.manifest_path = data / "manifest.json"
        if not self.manifest_path.exists():
            raise SystemExit(
                f"No manifest.json in {data}. Build from a publication: a checkout whose public/data "
                "holds manifest.json and artifacts/ (e.g. the Budget-day release branch), via --data."
            )
        self.manifest = json.loads(self.manifest_path.read_text())
        if self.manifest.get("schema") != MANIFEST_SCHEMA:
            raise SystemExit(f"Not a publication manifest: {self.manifest.get('schema')!r}")
        m = self.manifest
        self.measures = {
            k: Entry(data, k, e, False) for k, e in sorted(m["measures"].items()) if e["status"] in DISPLAYABLE
        }
        if not self.measures:
            raise SystemExit("The manifest has no approved or provisional measure: nothing to report")
        self.not_shown = [
            (k, e) for k, e in sorted(m["measures"].items()) if e["status"] not in DISPLAYABLE
        ]
        self.combined = self._combined()
        self.provisional = any(e.status == "provisional" for e in self.measures.values()) or (
            self.combined is not None and self.combined.status == "provisional"
        )
        self.candidate = is_candidate_manifest(m)
        self.provisional_label = CANDIDATE_PROVISIONAL_LABEL if self.candidate else PROVISIONAL_LABEL

    def _combined(self):
        ids = set(self.measures)
        if len(ids) == 1:
            return next(iter(self.measures.values()))
        for key in sorted(self.manifest.get("combined", {})):
            e = self.manifest["combined"][key]
            if e["status"] not in DISPLAYABLE or set(e.get("measures", [])) != ids:
                continue
            current = all(
                (e.get("member_outputs_sha256") or {}).get(i) == self.manifest["measures"][i].get("outputs_sha256")
                for i in ids
            )
            if current:
                return Entry(self.data, key, e, True)
        return None

    def flat(self, name: str):
        """A published flat file the manifest names (e.g. constituency.csv), checked."""
        digest = (self.manifest.get("flat_files") or {}).get(name)
        path = self.data / name
        if not digest or not path.exists():
            return None
        if sha256(path) != digest:
            raise SystemExit(f"{name} differs from the manifest's digest")
        return path


# --- Charts -------------------------------------------------------------


def setup_matplotlib():
    import matplotlib

    matplotlib.use("svg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["Inter", "DejaVu Sans"],
            "font.size": 9,
            "axes.edgecolor": AXIS,
            "axes.labelcolor": MUTED,
            "axes.titlesize": 9,
            "axes.titlecolor": INK,
            "axes.titlelocation": "left",
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "xtick.labelsize": 8.5,
            "ytick.labelsize": 8.5,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.unicode_minus": True,
            "legend.labelcolor": INK,
        }
    )
    return plt


def svg_of(plt, fig) -> str:
    buffer = io.StringIO()
    # Charts are drawn at the column width (COL_W) with constrained layout and
    # not cropped, so stretching them to the column keeps text at its set size.
    fig.savefig(buffer, format="svg", transparent=True)
    plt.close(fig)
    text = buffer.getvalue()
    text = text[text.index("<svg"):]
    text = re.sub(r"font-family:[^;\"']*", "font-family: Inter, sans-serif", text)
    text = re.sub(r'font-family="[^"]*"', 'font-family="Inter, sans-serif"', text)
    text = re.sub(r'(<svg[^>]*?) width="[^"]*" height="[^"]*"', r'\1 width="100%" aria-hidden="true"', text, count=1)
    return text


def png_of(plt, fig, dpi=200) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight", transparent=False, facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def tone(v, invert=False):
    """Gain tone for a gain to households (or a cost to the Treasury)."""
    if abs(v) < 1e-12:
        return NEUTRAL
    good = v > 0
    if invert:
        good = not good
    return GAIN if good else LOSS


def label_bars(ax, bars, labels, values, horizontal=False, size=7.8):
    for bar, text, v in zip(bars, labels, values):
        if horizontal:
            ax.annotate(
                text,
                (bar.get_width(), bar.get_y() + bar.get_height() / 2),
                xytext=(4 if v >= 0 else -4, 0),
                textcoords="offset points",
                ha="left" if v >= 0 else "right",
                va="center",
                fontsize=size,
                color=INK,
            )
        else:
            ax.annotate(
                text,
                (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                xytext=(0, 3 if v >= 0 else -3),
                textcoords="offset points",
                ha="center",
                va="bottom" if v >= 0 else "top",
                fontsize=size,
                color=INK,
            )


def pad_limits(values, lo_pad=0.22, hi_pad=0.22):
    lo, hi = min(0.0, min(values)), max(0.0, max(values))
    span = (hi - lo) or 1.0
    return lo - (span * lo_pad if lo < 0 else 0), hi + (span * hi_pad if hi > 0 else 0)


# The dashboard map's colour scale (src/utils/geography/scale.js and
# chartTheme.js CHART_COLOURS: loss, grid, mapGain, noData).
MAP_EXTENT_PCT = 1.0
MAP_NO_DATA = "#CBD5E1"


def _map_cmap():
    from matplotlib.colors import LinearSegmentedColormap

    return LinearSegmentedColormap.from_list("dashboard_map", ["#D97706", "#E5E7EB", "#14B8A6"], N=201)


def isolated_points(values, floor=500.0, factor=3):
    """Indices of single points far outside the rest of a curve: each differs
    from both neighbours, in the same direction, by more than ``floor`` and
    more than ``factor`` times the range of the other points."""
    out = []
    for i in range(1, len(values) - 1):
        a, v, b = values[i - 1], values[i], values[i + 1]
        rest = values[:i] + values[i + 1:]
        limit = max(floor, factor * (max(rest) - min(rest)))
        if (v - a) * (v - b) > 0 and min(abs(v - a), abs(v - b)) > limit:
            out.append(i)
    return out


def minus_ticks(ax, axis="y", fmt="{:g}"):
    from matplotlib.ticker import FuncFormatter

    f = FuncFormatter(lambda t, _: fmt.format(t).replace("-", MINUS))
    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(f)


def style_axes(ax, grid_axis="y"):
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


# --- The report ---------------------------------------------------------
#
# Layout follows the conventions of fiscal-event briefings: a cover, a key
# findings box, short numbered sections that flow page to page, numbered
# figures and tables titled with what they show (generated from the data, in
# neutral words) above a subtitle with units and year, with notes and a source
# line below; numbered footnotes; method, measures and glossary in annexes;
# a running header and footer with page numbers.

ZERO_PP = 0.005  # below this a percentage-point change prints as 0.00pp
ZERO_BN = 0.005  # below this a £bn change prints as £0.00bn


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def decile_phrase(i: int) -> str:
    """Decile number (1-10) → words, in the dashboard's terms."""
    if i == 1:
        return "the lowest-income tenth"
    if i == 10:
        return "the highest-income tenth"
    return f"the {ordinal(i)} decile"


def year_span(years: list[int]) -> str:
    if len(years) == 1:
        return f"in {fy(years[0])}"
    return f"from {fy(years[0])} to {fy(years[-1])}"


def sign_runs(years, values, tol):
    """Consecutive years grouped by the sign of the value (0 within tol)."""
    runs = []
    for y, v in zip(years, values):
        s = 0 if abs(v) < tol else (1 if v > 0 else -1)
        if runs and runs[-1][0] == s:
            runs[-1][1].append(y)
        else:
            runs.append((s, [y]))
    return runs


def css_string(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


class Report:
    def __init__(self, pub: Publication, year: int, title: str):
        self.pub = pub
        self.year = year
        # Headings keep their spaces (report.css), so a title typed with runs of spaces is normalised here.
        self.title = " ".join(title.split())
        self.t = Trace(pub.data)
        self.plt = setup_matplotlib()
        self.contract = json.loads(CONTRACT.read_text()) if CONTRACT.exists() else {}
        c = pub.combined
        if c is not None and year not in c.years:
            raise SystemExit(f"The combined run has no supported figures for {fy(year)}")
        self.years = sorted(
            set(c.years) if c is not None else set().union(*(set(e.years) for e in pub.measures.values()))
        )
        self.order = self._order()
        # One measure: its own run stands for "the measures together" (as the
        # dashboard's combinedEntryFor does), so name it, and leave out the
        # "each measure on its own" blocks, which would repeat its figures.
        self.single = c is not None and not c.combined
        self.together = c.name if self.single else "The measures together"
        self.plural = not self.single
        self.n_fig = self.n_tab = self.n_sec = self.n_fn = 0
        self.notes: list[tuple[int, str]] = []
        ident = (pub.manifest.get("execution") or {}).get("identity") or {}
        model = ident.get("model") or {}
        dataset = (ident.get("data") or {}).get("dataset", "")
        self._source_base = "PolicyEngine UK microsimulation" + (
            f" ({model.get('name', 'policyengine-uk')} {model.get('version', '')}"
            + (f", {dataset} data" if dataset else "")
            + ")"
            if model
            else ""
        )

    # Measures in the dashboard's order: raise revenue, then cost revenue,
    # each by size over the published years.
    def _order(self):
        totals = {}
        for k, e in self.pub.measures.items():
            totals[k] = sum(float(r["value"]) for r in e.table("budgetary_impact") if int(r["year"]) in e.years)
        raise_ = sorted((k for k in totals if totals[k] > 0), key=lambda k: -totals[k])
        cost = sorted((k for k in totals if totals[k] <= 0), key=lambda k: totals[k])
        return raise_ + cost

    def name(self, key):
        return self.pub.measures[key].name

    def verb(self, plural_form, singular_form):
        return plural_form if self.plural else singular_form

    # ---- figures with a trace
    def budget(self, e: Entry, year: int, fmt: str, section: str):
        r = e.row("budgetary_impact", year=year)
        if r is None or year not in e.years:
            return None, "n/a"
        v = float(r["value"])
        return v, self.t.fig(v, fmt, e.path("budgetary_impact"), "value", {"reform_id": e.key, "year": year}, section=section)

    def cell(self, e, table, column, match, fmt, section, transform="value"):
        r = e.row(table, **match)
        if r is None or r.get(column, "") == "":
            return None, "n/a"
        raw = float(r[column])
        v = TRANSFORMS[transform]([raw])
        return v, self.t.fig(v, fmt, e.path(table), column, {"reform_id": e.key, **match}, transform, section)

    # ---- page furniture: sources, figures, tables, footnotes, sections
    def source(self, runs: str) -> str:
        n = len(self.pub.measures)
        phrase = {
            "combined": "the measure's own run against current law" if self.single else f"one combined run of the {count_words(n)} measures against current law",
            "each": "each measure's own run against current law",
            "both": "the measure's own run against current law" if self.single else "the combined run and each measure's own run, against current law",
            "contract": "the dashboard's example-household definitions",
        }[runs]
        rev = self.pub.manifest.get("revision", "")
        return f"{self._source_base}; {phrase}; publication revision {rev}."

    def fn(self, text: str) -> str:
        """A numbered footnote: the marker here, the note at the section's end."""
        self.n_fn += 1
        self.notes.append((self.n_fn, text))
        return f'<sup class="fn"><a href="#fn{self.n_fn}">{self.n_fn}</a></sup>'

    def figure(self, chart, title, subtitle, alt, notes, runs="combined", img=False, after=""):
        """A numbered figure; ``after`` is its reading paragraph, kept on the same page."""
        self.n_fig += 1
        body = (
            f'<img src="{chart}" alt="{esc(alt)}">'
            if img
            else f'<div class="chart" role="img" aria-label="{esc(title)}. {esc(alt)}">{chart}</div>'
        )
        note = f'<p class="fnote"><span class="lab">Notes:</span> {esc(notes)}</p>' if notes else ""
        return (
            f'<figure id="figure-{self.n_fig}" aria-label="Figure {self.n_fig}: {esc(title)}"><figcaption><span class="fnum">Figure {self.n_fig}</span> '
            f'<span class="ftitle">{esc(title)}</span><span class="fsub">{esc(subtitle)}</span></figcaption>'
            f'{body}{note}<p class="fsrc"><span class="lab">Source:</span> {esc(self.source(runs))}</p>{after}</figure>'
        )

    def table(self, title, subtitle, head, rows, notes="", runs="combined", cls="", keep=True, after=""):
        self.n_tab += 1
        note = f'<p class="fnote"><span class="lab">Notes:</span> {notes}</p>' if notes else ""
        src = f'<p class="fsrc"><span class="lab">Source:</span> {esc(self.source(runs))}</p>' if runs else ""
        return (
            f'<div class="tblock{" keep" if keep else ""}"><table class="{cls}"><caption><span class="fnum">Table {self.n_tab}</span> '
            f'<span class="ftitle">{esc(title)}</span><span class="fsub">{esc(subtitle)}</span></caption>'
            f'<thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>{note}{src}{after}</div>'
        )

    def section(self, sid, title, intro, blocks, annex=None):
        """A numbered section. Its heading, introduction and first block are
        kept on one page (Chrome does not honour break-after: avoid alone)."""
        if annex:
            num, cls = f"Annex {annex}", "annex"
        else:
            self.n_sec += 1
            num, cls = str(self.n_sec), "sec"
        blocks = [b for b in blocks if b]
        head = f'<p class="secnum">{esc(num)}</p><h2>{esc(title)}</h2>{intro}'
        first = blocks[0] if blocks else ""
        rest = "".join(blocks[1:])
        notes = ""
        if self.notes:
            items = "".join(f'<li id="fn{n}" value="{n}">{t}</li>' for n, t in self.notes)
            notes = f'<ol class="footnotes" aria-label="Notes">{items}</ol>'
            self.notes = []
        return f'<section class="{cls}" id="{sid}"><div class="keep">{head}{first}</div>{rest}{notes}</section>'

    def notice(self, text):
        return f'<div class="notice" role="note"><p>{text}</p></div>'

    @staticmethod
    def explain(text):
        """A paragraph that says how to read the figure or table above it.
        It interprets (direction, rank, which measure drives a pattern) and
        prints no number that is not already traced."""
        return f'<p class="explain">{text}</p>' if text else ""

    @staticmethod
    def _names(names):
        names = list(names)
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]

    def no_combined(self, full=False):
        """Full notice in the key findings; a pointer to it in each section."""
        if not full:
            return self.notice("No combined run is published for exactly these measures (see the key findings), so this section shows each measure on its own only.")
        ids = ", ".join(self.name(k) for k in self.order)
        return self.notice(
            "<b>No combined run is published for exactly these measures.</b> "
            f"Figures for the measures together are left out rather than added up from each measure on its own ({esc(ids)})."
        )

    def unavailable(self, text):
        return self.notice(text)

    # ---- cover and key findings
    def cover(self):
        pub, m = self.pub, self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        versions = "".join(
            f"<span>{esc(ident[k]['name'])} {esc(ident[k]['version'])}</span>" for k in ("wrapper", "model") if k in ident
        )
        n = len(pub.measures)
        updated_text = long_date(m.get("updated_at", ""))
        status = (
            f'<p class="status-banner" role="note">{esc(pub.provisional_label)}</p>' if pub.provisional else ""
        )
        budget_date = (m.get("budget") or {}).get("date", "")
        return f"""
<section class="cover" aria-label="Cover">
  <div class="cover-band"></div>
  <div class="cover-body">
    {self.logo()}
    <p class="cover-kicker">Budget analysis</p>
    <h1>{esc(self.title)}</h1>
    <p class="sub">How {count_words(n)} measure{'s' if n != 1 else ''} would change the public finances, household incomes, poverty and inequality, modelled with PolicyEngine UK. Figures for {fy(self.year)} unless stated.</p>
    {status}
  </div>
  {self.contents()}
  <dl class="cover-meta">
    <div><dt>Budget</dt><dd>{esc(long_date(budget_date))}</dd></div>
    <div><dt>Publication</dt><dd>Revision {esc(m.get('revision', ''))}, {esc(updated_text)}</dd></div>
    <div><dt>Model</dt><dd>{versions}</dd></div>
  </dl>
</section>"""

    def logo(self):
        path = REPO / "public" / "assets" / "logos" / "policyengine-teal.png"
        if path.exists():
            data = base64.b64encode(path.read_bytes()).decode()
            return f'<img class="logo" src="data:image/png;base64,{data}" alt="PolicyEngine">'
        return '<p class="logo-text">PolicyEngine</p>'

    def key_findings(self):
        """4 to 7 findings, each from traced figures, each fact stated once."""
        c, y, S = self.pub.combined, self.year, "summary"
        items = []
        if c is None:
            box = self.no_combined(full=True)
        else:
            T = self.together
            years = self.years
            # Public finances
            rev = float(c.row("budgetary_impact", year=y)["value"])
            rev_words = self.t.fig(rev, "bn_words", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": y}, section=S)
            if abs(rev) < ZERO_BN:
                lead = f"{T} {self.verb('leave', 'leaves')} government revenue unchanged in {fy(y)} (to within {rev_words})."
            elif rev < 0:
                lead = f"{T} {self.verb('cost', 'costs')} the government {rev_words} in {fy(y)}."
            else:
                lead = f"{T} {self.verb('raise', 'raises')} {rev_words} for the government in {fy(y)}."
            vals = [(yy, float(c.row("budgetary_impact", year=yy)["value"])) for yy in years if c.row("budgetary_impact", year=yy) is not None]
            if len(vals) == len(years) and len(years) > 1:
                total = sum(v for _, v in vals)
                ttext = self.t.fig(total, "bn_words", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": years}, "sum", S)
                costs = [yy for yy, v in vals if v <= -ZERO_BN]
                raises = [yy for yy, v in vals if v >= ZERO_BN]
                verb = ("cost" if total < 0 else "raise") + ("" if self.plural else "s")
                lead += f" Over {fy(years[0])} to {fy(years[-1])} {self.verb('they', 'it')} {verb} {ttext}"
                if costs and raises:
                    lead += f" net: {self._span(costs)} {self.verb('they', 'it')} {'cost' if self.plural else 'costs'} revenue, and {self._span(raises)} {self.verb('they', 'it')} {'raise' if self.plural else 'raises'} it (Section {self._sec_of('revenue')})."
                else:
                    lead += " in total."
            items.append(("Public finances.", lead))
            # Largest measure on its own, in the report year and over the period
            if not self.single:
                best = None
                for k in self.order:
                    e = self.pub.measures[k]
                    r = e.row("budgetary_impact", year=y)
                    if r is not None and y in e.years and (best is None or abs(float(r["value"])) > abs(best[1])):
                        best = (k, float(r["value"]))
                totals = {}
                for k in self.order:
                    e = self.pub.measures[k]
                    rs = [e.row("budgetary_impact", year=yy) for yy in years]
                    if all(r is not None for r in rs) and all(yy in e.years for yy in years):
                        totals[k] = sum(float(r["value"]) for r in rs)
                best_t = max(totals.items(), key=lambda kv: abs(kv[1])) if totals and len(years) > 1 else None
                if best is not None and abs(best[1]) >= ZERO_BN:
                    e = self.pub.measures[best[0]]
                    v, txt = self.budget(e, y, "bn_words", S)
                    s = f"On its own, {esc(e.name)} has the largest effect on revenue in {fy(y)}: it {'costs' if v < 0 else 'raises'} {txt}."
                    if best_t is not None and best_t[0] != best[0] and abs(best_t[1]) >= ZERO_BN:
                        et = self.pub.measures[best_t[0]]
                        tt = self.t.fig(best_t[1], "bn_words", et.path("budgetary_impact"), "value", {"reform_id": et.key, "year": years}, "sum", S)
                        s += f" Over {fy(years[0])} to {fy(years[-1])}, {esc(et.name)} has the largest effect: it {'costs' if best_t[1] < 0 else 'raises'} {tt} in total."
                    items.append(("Largest measure.", s))
            # Households, in the report year and, where it differs, the last year
            hh, hh_text = self.cell(c, "winners_losers", "avg_change", {"year": y, "decile": "all"}, "gbp", S)
            if hh is not None:
                if abs(hh) < 0.5:
                    s = f"Average household net income is unchanged in {fy(y)} (less than 50p a year)."
                else:
                    s = f"Average household net income {'rises' if hh > 0 else 'falls'} by {hh_text.lstrip('+' + MINUS)} a year in {fy(y)}."
                items.append(("Household incomes.", s))
            later = self._later_years(c, hh, S)
            if later:
                items.append(("Later years.", later))
            # Distribution
            lo, lo_text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": "1st"}, "pct2", S)
            hi, hi_text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": "10th"}, "pct2", S)
            items.append(("By income.", f"As a share of net income, the lowest-income tenth of households {self._share_verb(lo, lo_text)} and the highest-income tenth {self._share_verb(hi, hi_text)}."))
            # Gainers and losers
            b, bt = self.cell(c, "age_impact", "pct_better_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            w, wt = self.cell(c, "age_impact", "pct_worse_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            if b is not None:
                wphrase = "fewer than 0.05%" if w is not None and abs(w) < 0.05 else wt
                items.append(("Gainers and losers.", f"{bt} of people live in households that are better off and {wphrase} in households that are worse off."))
            # Poverty: below half a hundredth of a point, say unchanged rather than print 0.00pp
            pr = c.row("poverty_inequality", year=y)
            if pr is not None and pr.get("poverty_abs_bhc_change_pp", "") != "":
                p = float(pr["poverty_abs_bhc_change_pp"])
                kraw = pr.get("child_poverty_abs_bhc_change_pp", "")
                k = float(kraw) if kraw != "" else None
                if abs(p) < ZERO_PP and (k is None or abs(k) < ZERO_PP):
                    who = "for all people and for children" if k is not None else "for all people"
                    s = f"Absolute poverty before housing costs is unchanged in {fy(y)} {who} (a change of less than 0.005 percentage points)."
                else:
                    _, pt = self.cell(c, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": y}, "pp2", S)
                    s = f"Absolute poverty before housing costs changes by {pt} for all people"
                    if k is not None:
                        _, kt = self.cell(c, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": y}, "pp2", S)
                        s += f" and {kt} for children"
                    s += f" in {fy(y)}."
                items.append(("Poverty.", s))
            box = "<ol>" + "".join(f"<li><b>{h}</b> {t}</li>" for h, t in items[:7]) + "</ol>"
        return f"""
<section id="summary" aria-labelledby="kf-title">
  <div class="kf">
    <h2 id="kf-title">Key findings</h2>
    {box}
  </div>
</section>"""

    @staticmethod
    def _span(ys):
        """Years in words: 'from 2026-27 to 2030-31' when consecutive, else listed."""
        if len(ys) == 1 or all(b - a == 1 for a, b in zip(ys, ys[1:])):
            return year_span(ys)
        return "in " + ", ".join(fy(v) for v in ys[:-1]) + " and " + fy(ys[-1])

    def _later_years(self, c, hh, S):
        """The last year, when the average change in household income there
        differs in sign from the report year's, with the measure behind it."""
        last = self.years[-1]
        if last == self.year or hh is None:
            return ""
        r = c.row("winners_losers", year=last, decile="all")
        if r is None or r.get("avg_change", "") == "":
            return ""
        hl = float(r["avg_change"])
        if abs(hl) < 0.5 or (abs(hh) >= 0.5 and (hl > 0) == (hh > 0)):
            return ""
        _, hl_text = self.cell(c, "winners_losers", "avg_change", {"year": last, "decile": "all"}, "gbp", S)
        when = ""
        if not self.single:
            best = None
            for k in self.order:
                e = self.pub.measures[k]
                rl = e.row("winners_losers", year=last, decile="all")
                ry = e.row("winners_losers", year=self.year, decile="all")
                if rl is None or rl.get("avg_change", "") == "":
                    continue
                v = float(rl["avg_change"])
                new = ry is None or ry.get("avg_change", "") == "" or abs(float(ry["avg_change"])) < 0.5
                if (v > 0) == (hl > 0) and abs(v) >= 0.5 and new and (best is None or abs(v) > best[0]):
                    best = (abs(v), k)
            if best is not None:
                when = f", when {esc(self.name(best[1]))} takes effect,"
        return f"By {fy(last)}{when} average household net income {'rises' if hl > 0 else 'falls'} by {hl_text.lstrip('+' + MINUS)} a year (Section {self._sec_of('deciles')})."

    def scope(self):
        """What the report compares: the first block of the introduction."""
        n = len(self.pub.measures)
        c = self.pub.combined
        together = (
            " Figures for the measures together come from one simulation of all of them, never from adding up each measure's own figures."
            if c is not None and not self.single
            else ""
        )
        return f"""<div class="keep"><h3>What the report compares</h3>
<p>Each figure compares two simulations of the same UK households: current law, and current law with the {count_words(n)} measure{'s' if n != 1 else ''} in Table 1. The difference is the effect of the measure{'s' if n != 1 else ''}.{together}</p>
<p>The figures cover {fy(self.years[0])} to {fy(self.years[-1])}; results by household are for {fy(self.year)} unless stated. They are static: people are assumed not to change what they earn, spend, save or claim in response. Annex A sets out the method and what the figures leave out.</p></div>"""

    def introduction(self):
        """What PolicyEngine is, what the report compares, how to read it, and the measures."""
        blocks = [
            self.scope(),
            f"""<div class="keep"><h3>How to read the figures</h3>
<ul>
<li><b>Public finances.</b> The change in government revenue, £ billion a year. Below zero a measure costs the government; above zero it raises revenue.</li>
<li><b>Households.</b> The change in household net income (after taxes, including benefits), £ a year. Teal marks a gain to households, orange a loss.</li>
<li><b>Income deciles.</b> Households ranked into ten equal groups by income before the measures, adjusted for household size; decile 1 is the lowest-income tenth.</li>
<li><b>Poverty.</b> Changes in the share of people in poverty, in percentage points, on the measures set out in Section {self._sec_of('poverty')}.</li>
<li><b>Provisional.</b> While any figure is provisional, every page says so; provisional figures can change before they are approved.</li>
</ul>
<p>The interactive version, including a calculator for a household's own circumstances, is at policyengine.org/uk/autumn-budget-2026.</p></div>""",
            self.measures_table(),
        ]
        intro = """<p>PolicyEngine is an open-source microsimulation model of the UK tax and benefit system. It applies the rules of each tax and benefit to a representative survey of UK households, weighted to official totals, once under current law and once with the measures, and reports the difference for the government and for households. The code and data behind every figure are public.</p>"""
        return self.section("introduction", "Introduction", intro, blocks)

    def _sec_of(self, sid):
        return self._secnums.get(sid, "")

    @staticmethod
    def _share_verb(v, text):
        if v is None:
            return "has no published figure"
        if text.lstrip("+" + MINUS).startswith("0.00"):
            return "sees almost no change"
        return f"{'gains' if v > 0 else 'loses'} {text.lstrip('+' + MINUS)}"

    def contents(self):
        toc = [("summary", "", "Key findings")] + self._toc
        rows = "".join(f'<li><a href="#{a}"><span class="n">{esc(n)}</span>{esc(t)}</a></li>' for a, n, t in toc)
        return f'<nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>{rows}</ol></nav>'

    # ---- charts
    def _bar_chart(self, labels, vals, texts, colours, height=2.3, size=7.6, ylabel=None):
        """Vertical bars at the column width. A value of None is a withheld
        cell: no bar, labelled "withheld", left out of the axis range."""
        plt = self.plt
        fig, ax = plt.subplots(figsize=(COL_W, height), layout="constrained")
        shown = [0.0 if v is None else v for v in vals]
        colours = ["none" if v is None else col for v, col in zip(vals, colours)]
        texts = [WITHHELD if v is None else t for v, t in zip(vals, texts)]
        bars = ax.bar(labels, shown, color=colours, width=0.6)
        ax.axhline(0, color=ZERO, linewidth=0.8)
        label_bars(ax, bars, texts, shown, size=size)
        ax.set_ylim(*pad_limits([v for v in vals if v is not None] or [0.0], 0.3, 0.3))
        if ylabel:
            ax.set_ylabel(ylabel, fontsize=7.6)
        minus_ticks(ax)
        style_axes(ax)
        ax.tick_params(axis="x", length=0)
        return svg_of(plt, fig)

    @staticmethod
    def _withheld_note(vals):
        return WITHHELD_NOTE if any(v is None for v in vals) else ""

    # ---- sections
    def revenue(self):
        pub, c, S = self.pub, self.pub.combined, "revenue"
        plt = self.plt
        T = self.together
        blocks = []
        intro = (
            "<p>The change in government revenue each year. Below zero the measures cost the government; above zero they raise revenue. "
            "Measures are in the order of Table 1.</p>"
        )
        colour_note = "Teal: costs revenue (households pay less or receive more); orange: raises revenue (households pay more)."
        if c is not None:
            vals, labels, years = [], [], []
            for y in self.years:
                v, text = self.budget(c, y, "bn2", S)
                if v is None:
                    continue
                vals.append(v)
                labels.append(text)
                years.append(y)
            chart = self._bar_chart([fy(y) for y in years], vals, labels, [tone(v, invert=True) for v in vals], height=2.3)
            parts = []
            for s, ys in sign_runs(years, vals, ZERO_BN):
                if s < 0:
                    parts.append(f"{self.verb('cost', 'costs') if not parts else 'cost'} revenue {year_span(ys)}")
                elif s > 0:
                    parts.append(f"{self.verb('raise', 'raises') if not parts else 'raise'} revenue {year_span(ys)}")
                else:
                    parts.append(f"{self.verb('leave', 'leaves') if not parts else 'leave'} it unchanged {year_span(ys)}")
            if len(parts) > 1:
                parts = [parts[0]] + [p.replace("revenue ", "it ", 1) for p in parts[1:]]
            title = f"{T} " + (", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0])
            alt = "; ".join(f"{fy(y)}: {t}" for y, t in zip(years, labels))
            blocks.append(self.figure(chart, title, "Change in government revenue by year, £ billion, UK", alt, colour_note,
                                      after=self.explain(self._revenue_drivers(years, vals))))
        else:
            blocks.append(self.no_combined())

        # Each measure in the report year
        y = self.year
        keys = [] if self.single else [
            k for k in self.order
            if self.pub.measures[k].row("budgetary_impact", year=y) is not None and y in self.pub.measures[k].years
        ]
        vals, labels = [], []
        for k in keys:
            v, text = self.budget(pub.measures[k], y, "bn2", S)
            vals.append(v)
            labels.append(text)
        if keys:
            fig, ax = plt.subplots(figsize=(COL_W, 0.36 * len(keys) + 0.6), layout="constrained")
            names = [self.name(k) for k in keys][::-1]
            bars = ax.barh(names, vals[::-1], color=[tone(v, invert=True) for v in vals[::-1]], height=0.6)
            ax.axvline(0, color=ZERO, linewidth=0.8)
            label_bars(ax, bars, labels[::-1], vals[::-1], horizontal=True)
            ax.set_xlim(*pad_limits(vals, 0.35, 0.3))
            ax.tick_params(axis="y", length=0, labelsize=8.3, labelcolor=INK)
            minus_ticks(ax, "x")
            style_axes(ax, "x")
            alt = "; ".join(f"{self.name(k)}: {t}" for k, t in zip(keys, labels))
            big = max(range(len(keys)), key=lambda i: abs(vals[i]))
            if abs(vals[big]) < ZERO_BN:
                title = f"No measure on its own changes revenue by £5 million or more in {fy(y)}"
            else:
                title = f"On its own, {self.name(keys[big])} has the largest effect on revenue in {fy(y)}"
            idle = [self.name(k) for k, v in zip(keys, vals) if abs(v) < ZERO_BN]
            after = ""
            if idle:
                after = self.explain(
                    f"{self._names(idle)} {'has' if len(idle) == 1 else 'have'} no effect on revenue in {fy(y)}; "
                    f"Table {self.n_tab + 1} shows the years in which each measure changes revenue."
                )
            blocks.append(self.figure(svg_of(plt, fig), title, f"Change in government revenue by measure, £ billion, UK, {fy(y)}", alt, f"Each measure on its own against current law; colours as in Figure {self.n_fig}." if c is not None else "Each measure on its own against current law. " + colour_note, runs="each", after=after))

        # Table: every year, and the period total
        head = '<th scope="col">Measure</th>' + "".join(f'<th scope="col" class="num">{fy(y)}</th>' for y in self.years) + '<th scope="col" class="num">Total</th>'
        rows = []
        any_na = False
        for k in self.order:
            e = pub.measures[k]
            cells = []
            vs = []
            for yy in self.years:
                v, text = self.budget(e, yy, "bn2_plain", S + "-table")
                cells.append(f'<td class="num {self._cls(v)}">{text}</td>')
                if v is not None:
                    vs.append(v)
            if len(vs) == len(self.years):
                total = sum(vs)
                ttext = self.t.fig(total, "bn2_plain", e.path("budgetary_impact"), "value", {"reform_id": e.key, "year": self.years}, "sum", S + "-table")
            else:
                # A total over fewer years than the column says would mislead
                total, ttext = None, "n/a"
                any_na = True
            rows.append(f'<tr><th scope="row">{esc(e.name)}</th>{"".join(cells)}<td class="num total-col {self._cls(total)}">{ttext}</td></tr>')
        if c is not None and not self.single:
            cells, vs = [], []
            for yy in self.years:
                v, text = self.budget(c, yy, "bn2_plain", S + "-table")
                cells.append(f'<td class="num">{text}</td>')
                if v is not None:
                    vs.append(v)
                else:
                    any_na = True
            total = sum(vs)
            ttext = self.t.fig(total, "bn2_plain", c.path("budgetary_impact"), "value", {"reform_id": c.key, "year": self.years}, "sum", S + "-table")
            rows.append(f'<tr class="total"><th scope="row">All measures together</th>{"".join(cells)}<td class="num total-col">{ttext}</td></tr>')
        blocks.append(
            self.table(
                "Change in government revenue by measure and year",
                f"£ billion, UK, {fy(self.years[0])} to {fy(self.years[-1])}",
                head,
                rows,
                f"Negative values cost revenue. Total: {fy(self.years[0])} to {fy(self.years[-1])}, shown only when every year has a figure."
                + (" n/a: no supported figure." if any_na else "")
                + ("" if self.single or c is None else " The last row is the combined run, not the sum of the rows above."),
                runs="combined" if self.single else ("both" if c is not None else "each"),
            )
        )
        return self.section("revenue", "Public finances", intro, blocks)

    def _revenue_drivers(self, years, vals):
        """For each year whose sign differs from the report year's, name the
        measure(s) behind it, and say why the sign changes only when each
        measure's own figures show it."""
        if self.single or self.pub.combined is None or self.year not in years:
            return ""
        base = vals[years.index(self.year)]
        out = []
        for yy, v in zip(years, vals):
            if abs(v) < ZERO_BN or abs(base) < ZERO_BN or (v > 0) == (base > 0):
                continue
            same, other = [], 0.0
            for k in self.order:
                e = self.pub.measures[k]
                r = e.row("budgetary_impact", year=yy)
                if r is None or yy not in e.years:
                    continue
                x = float(r["value"])
                if abs(x) >= ZERO_BN and (x > 0) == (v > 0):
                    same.append((abs(x), k))
                else:
                    other += x
            if not same:
                continue
            same.sort(reverse=True)
            word, opp = ("raise", "cost") if v > 0 else ("cost", "raise")
            outweighs = sum(a for a, _ in same) > abs(other)
            if len(same) == 1:
                k = same[0][1]
                e = self.pub.measures[k]
                only = all(
                    (r := e.row("budgetary_impact", year=z)) is None or abs(float(r["value"])) < ZERO_BN
                    for z in years if z != yy
                )
                who = esc(self.name(k)) + (", which changes revenue only that year," if only else "")
                if outweighs:
                    out.append(f"In {fy(yy)} the measures together {word} revenue: {who} {word}s more on its own than the other measures {opp}")
                else:
                    out.append(f"In {fy(yy)} the measures together {word} revenue; on its own, {who} is the only measure that {word}s revenue that year")
            else:
                lead = esc(self.name(same[0][1]))
                if outweighs:
                    out.append(f"In {fy(yy)} the measures together {word} revenue: on their own, the measures that {word} it, led by {lead}, {word} more than the others {opp}")
                else:
                    out.append(f"In {fy(yy)} the measures together {word} revenue; {lead} is the largest of the measures that {word} it that year")
        return (". ".join(out) + ".") if out else ""

    @staticmethod
    def _cls(v):
        if v is None or abs(v) < 0.005:
            return ""
        return "costs" if v < 0 else "raises"

    def _spread_title(self, vals, names, unit_word, who):
        """'X in every group gain on average, most in Y' in neutral words."""
        sig = [v for v in vals if v is not None]
        gains = [i for i, v in enumerate(vals) if v is not None and v >= 0.5]
        losses = [i for i, v in enumerate(vals) if v is not None and v <= -0.5]
        if not sig:
            return f"No published figures by {unit_word}"
        every = f"every {unit_word}" if len(sig) == len(vals) else f"every {unit_word} with a published figure"
        if len(gains) == len(sig):
            i = max(gains, key=lambda i: vals[i])
            return f"{who} in {every} gain on average, most in cash terms {names[i]}"
        if len(losses) == len(sig):
            i = min(losses, key=lambda i: vals[i])
            return f"{who} in {every} lose on average, most in cash terms {names[i]}"
        return f"On average, {who.lower()} gain in {count_words(len(gains))} {unit_word}s and lose in {count_words(len(losses))}"

    def deciles(self):
        c, y, S = self.pub.combined, self.year, "deciles"
        intro = (
            f"<p>The change in household net income in {fy(y)} by income decile (see how to read the figures, Section 1). "
            "Averages are over all households in each decile, including those with no change.</p>"
        )
        blocks = []
        if c is None:
            blocks.append(self.no_combined())
        else:
            blocks.append(self._by_year(c))
            abs_vals, abs_labels, rel_vals, rel_labels = [], [], [], []
            for d, rd in zip(DECILES, REL_DECILES):
                v, text = self.cell(c, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S)
                abs_vals.append(v)
                abs_labels.append(WITHHELD if v is None else text)
                v, text = self.cell(c, "distributional_impact", "value", {"year": y, "decile": rd}, "pct2", S)
                rel_vals.append(v)
                rel_labels.append(WITHHELD if v is None else text)
            names = [f"in {decile_phrase(i)}" for i in range(1, 11)]
            title = self._spread_title(abs_vals, names, "decile", "Households")
            chart = self._bar_chart(DECILES, abs_vals, abs_labels, [tone(v or 0.0) for v in abs_vals], height=2.2, size=7.2)
            alt = "; ".join(f"decile {d}: {a}" for d, a in zip(DECILES, abs_labels))
            blocks.append(self.figure(chart, title, f"Average change in household net income by income decile, £ a year, UK, {fy(y)}", alt, self._withheld_note(abs_vals)))
            f_abs = self.n_fig
            rel_sig = [(i, v) for i, v in enumerate(rel_vals) if v is not None]
            if not rel_sig or all(abs(v) < 0.005 for _, v in rel_sig):
                rtitle = "As a share of net income, no decile's income changes by 0.005% or more"
            else:
                i, vi = max(rel_sig, key=lambda iv: abs(iv[1]))
                rtitle = f"As a share of net income, {decile_phrase(i + 1)} {'gains' if vi > 0 else 'loses'} most"
            chart = self._bar_chart(DECILES, rel_vals, rel_labels, [tone(v or 0.0) for v in rel_vals], height=2.2, size=7.2)
            alt = "; ".join(f"decile {d}: {r}" for d, r in zip(DECILES, rel_labels))
            a0, a9, r0, r9 = abs_vals[0], abs_vals[9], rel_vals[0], rel_vals[9]
            read = ""
            if None not in (a0, a9, r0, r9):
                if a9 > a0 > 0 and r0 > r9 > 0:
                    read = (
                        f"Figures {f_abs} and {f_abs + 1} read together: the cash gain is larger for higher-income households, "
                        "but smaller relative to their income, so the gain is a larger share of income for lower-income households."
                    )
                elif a0 > a9 > 0:
                    read = "The cash gain is larger for lower-income households than for higher-income ones."
            blocks.append(self.figure(chart, rtitle, f"Average change in household net income by income decile, % of net income, UK, {fy(y)}", alt, self._withheld_note(rel_vals), after=self.explain(read)))

        # Each measure by decile (one measure: the charts above are its own)
        if not self.single:
            head = '<th scope="col">Measure</th>' + "".join(f'<th scope="col" class="num">{d}</th>' for d in DECILES)
            rows = []
            withheld = False
            for k in self.order:
                e = self.pub.measures[k]
                cells = []
                for d in DECILES:
                    v, text = self.cell(e, "winners_losers", "avg_change", {"year": y, "decile": d}, "gbp", S + "-table")
                    if v is None:
                        text, withheld = WITHHELD, True
                    cells.append(f'<td class="num {self._tone_cls(v)}">{text}</td>')
                rows.append(f'<tr><th scope="row">{esc(e.name)}</th>{"".join(cells)}</tr>')
            tops = []
            for d in DECILES:
                best = None
                for k in self.order:
                    r = self.pub.measures[k].row("winners_losers", year=y, decile=d)
                    if r is not None and r.get("avg_change", "") != "" and (best is None or abs(float(r["avg_change"])) > best[0]):
                        best = (abs(float(r["avg_change"])), k)
                if best is not None and best[0] >= 0.5:
                    tops.append(best[1])
            read = ""
            if c is not None and tops and len(set(tops)) == 1 and len(tops) == len(DECILES):
                read = f"On its own, {esc(self.name(tops[0]))} changes average income by most in every decile, so it sets the shape of Figure {f_abs}."
            blocks.append(
                self.table(
                    "Each measure on its own: average change in household net income by income decile",
                    f"£ a year, UK, {fy(y)}",
                    head,
                    rows,
                    "£0: no change on average, or less than 50p." + (" " + WITHHELD_NOTE if withheld else ""),
                    runs="each",
                    cls="compact",
                    after=self.explain(read),
                )
            )
        return self.section("deciles", "Households by income decile", intro, blocks)

    def _by_year(self, c):
        """The measures together: the average change for all households in
        each year, so a measure that takes effect outside the report year
        shows here, with the measure behind each year of opposite sign."""
        S = "deciles-years"
        vals, cells = [], []
        for yy in self.years:
            v, t = self.cell(c, "winners_losers", "avg_change", {"year": yy, "decile": "all"}, "gbp", S)
            vals.append(v)
            cells.append(f'<td class="num {self._tone_cls(v)}">{WITHHELD if v is None else t}</td>')
        head = '<th scope="col"></th>' + "".join(f'<th scope="col" class="num">{fy(yy)}</th>' for yy in self.years)
        read = ""
        known = [(yy, v) for yy, v in zip(self.years, vals) if v is not None]
        runs = sign_runs([yy for yy, _ in known], [v for _, v in known], 0.5)
        if len(runs) > 1:
            word = {1: "rises", -1: "falls", 0: "is unchanged"}
            parts = [f"{word[s]} {self._span(ys)}" for s, ys in runs]
            read = "Average household net income " + ", ".join(parts[:-1]) + " and " + parts[-1] + "."
            if not self.single:
                notes = []
                for s, ys in runs:
                    if s == 0 or self.year in ys:
                        continue
                    yy = ys[-1]
                    best = None
                    for k in self.order:
                        r = self.pub.measures[k].row("winners_losers", year=yy, decile="all")
                        if r is None or r.get("avg_change", "") == "":
                            continue
                        x = float(r["avg_change"])
                        if (x > 0) == (s > 0) and abs(x) >= 0.5 and (best is None or abs(x) > best[0]):
                            best = (abs(x), k)
                    if best is not None:
                        notes.append(f"in {fy(yy)}, {esc(self.name(best[1]))} has the largest such effect on its own")
                if notes:
                    read += " " + "; ".join(notes)[0].upper() + "; ".join(notes)[1:] + "."
        return self.table(
            f"{self.together}: average change in household net income by year",
            f"£ a year, all households, UK, {fy(self.years[0])} to {fy(self.years[-1])}",
            head,
            [f'<tr><th scope="row">All households</th>{"".join(cells)}</tr>'],
            self._withheld_note(vals),
            cls="compact",
            after=self.explain(read),
        )

    @staticmethod
    def _tone_cls(v):
        if v is None or abs(v) < 0.5:
            return ""
        return "gain" if v > 0 else "loss"

    def winners(self):
        y, S = self.year, "winners"
        entries = ([self.pub.combined] if self.pub.combined is not None and self.pub.combined.combined else []) + [
            self.pub.measures[k] for k in self.order
        ]
        rows, complete, withheld = [], [], False
        for e in entries:
            b, bt = self.cell(e, "age_impact", "pct_better_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            u, ut = self.cell(e, "age_impact", "pct_unchanged", {"year": y, "age_band": "all"}, "pct1_plain", S)
            w, wt = self.cell(e, "age_impact", "pct_worse_off", {"year": y, "age_band": "all"}, "pct1_plain", S)
            name = "All measures together" if e.combined else e.name
            if b is None and u is None and w is None:
                continue
            if None in (b, u, w):
                # One share withheld would reveal itself from the other two: withhold the row
                withheld = True
                rows.append(f'<tr><th scope="row">{esc(name)}</th>' + f'<td class="num">{WITHHELD}</td>' * 3 + "</tr>")
                continue
            rows.append(f'<tr><th scope="row">{esc(name)}</th><td class="num">{bt}</td><td class="num">{ut}</td><td class="num">{wt}</td></tr>')
            complete.append((e, b, w))
        intro = f"<p>The share of people living in households whose net income rises, does not change, or falls in {fy(y)}. A household counts as better off when its net income rises by more than 0.01% (£3 a year on £30,000), worse off when it falls by more than that, and unchanged otherwise. People are counted by the household they live in.</p>"
        blocks = []
        if rows:
            first = complete[0] if complete else None
            title = "People better off, unchanged and worse off"
            if first is not None:
                b0, w0 = first[1], first[2]
                who = "the measures together" if first[0].combined else first[0].name
                if b0 > 50:
                    title = f"Most people live in households that are better off under {who}"
                elif w0 > 50:
                    title = f"Most people live in households that are worse off under {who}"
                elif b0 > w0:
                    title = f"More people are better off than worse off under {who}"
                elif w0 > b0:
                    title = f"More people are worse off than better off under {who}"
                else:
                    title = f"As many people are better off as worse off under {who}"
            own = [(e, b, w) for e, b, w in complete if not e.combined]
            none_ = [e for e, b, w in own if b == 0 and w == 0]
            few = [e for e, b, w in own if b < 0.05 and w < 0.05 and not (b == 0 and w == 0)]
            reach = max(((b, e.name) for e, b, _ in own), default=None)
            parts = []
            if reach is not None and reach[0] >= 0.05 and len(own) > 1:
                parts.append(f"Of the measures on their own, {esc(reach[1])} makes the most people better off")
            if none_:
                parts.append(f"{esc(self._names([e.name for e in none_]))} {'changes' if len(none_) == 1 else 'change'} no household's income by more than 0.01% in {fy(y)}")
            if few:
                parts.append(f"{esc(self._names([e.name for e in few]))} {'makes' if len(few) == 1 else 'make'} fewer than 0.05% of people better or worse off in {fy(y)}")
            why = [self._active_years(e) for e in none_ + few]
            why = [w for w in why if w]
            read = ""
            if parts:
                read = "; ".join(parts) + ("" if not why else " (" + "; ".join(why) + ")") + "."
                read = read[0].upper() + read[1:]
            blocks.append(
                self.table(
                    title[0].upper() + title[1:],
                    f"% of people, UK, {fy(y)}",
                    '<th scope="col">Measure</th><th scope="col" class="num">Better off</th><th scope="col" class="num">No change</th><th scope="col" class="num">Worse off</th>',
                    rows,
                    ("" if self.single else "The first row is the measures together; the others each measure on its own.") + (" " + WITHHELD_NOTE if withheld else ""),
                    runs="both",
                    after=self.explain(read),
                )
            )
        else:
            blocks.append(self.unavailable("No published figures for this year."))
        return self.section("winners", "Gainers and losers", intro, blocks)

    def _active_years(self, e):
        """'X changes revenue only in 2026-27', from the measure's own budgetary impact."""
        ys = []
        for yy in self.years:
            r = e.row("budgetary_impact", year=yy)
            if r is not None and yy in e.years and abs(float(r["value"])) >= ZERO_BN:
                ys.append(yy)
        if not ys or self.year in ys:
            return ""
        return f"{esc(e.name)} changes revenue only {self._span(ys)}"

    def poverty(self):
        c, y, S = self.pub.combined, self.year, "poverty"
        T = self.together
        intro = (
            "<p>Absolute poverty: below 60% of the 2024-25 median income, held fixed in real terms. Relative poverty: below 60% of the median in the same year, so the line moves with the measures. "
            "Children are counted as in DWP's statistics"
            + self.fn("Households Below Average Income: a child is in poverty when the household they live in is. Poverty is measured on equivalised household net income, before (BHC) and after (AHC) housing costs.")
            + ". Before (BHC) and after (AHC) housing costs.</p>"
        )
        blocks = []
        if c is None:
            blocks.append(self.no_combined())
        else:
            years, a_vals, a_labels, k_vals, k_labels = [], [], [], [], []
            for yy in self.years:
                v, t = self.cell(c, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": yy}, "pp2", S)
                kv, kt = self.cell(c, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": yy}, "pp2", S)
                if v is None:
                    continue
                years.append(yy)
                a_vals.append(v)
                a_labels.append(t)
                k_vals.append(kv)
                k_labels.append(WITHHELD if kv is None else kt)
            head = '<th scope="col">People</th>' + "".join(f'<th scope="col" class="num">{fy(yy)}</th>' for yy in years)
            sig = a_vals + [v for v in k_vals if v is not None]
            read = ""
            if sig and max(abs(v) for v in sig) < 0.1:
                read = f"Every change in absolute poverty before housing costs, for all people and for children, is smaller than a tenth of a percentage point in every year from {fy(years[0])} to {fy(years[-1])}."
            if a_vals and all(abs(v) < ZERO_PP for v in a_vals):
                title = f"{T} {self.verb('leave', 'leaves')} absolute poverty before housing costs unchanged to two decimal places in every year"
            elif a_vals:
                i = max(range(len(years)), key=lambda i: abs(a_vals[i]))
                title = f"{T} {self.verb('change', 'changes')} absolute poverty before housing costs most in {fy(years[i])}, when it {'rises' if a_vals[i] > 0 else 'falls'}"
            else:
                title = f"{T}: change in absolute poverty before housing costs by year"
            blocks.append(
                self.table(
                    title,
                    "Percentage points, UK",
                    head,
                    [
                        f'<tr><th scope="row">All people</th>{"".join(f"<td class=num>{t}</td>" for t in a_labels)}</tr>',
                        f'<tr><th scope="row">Children</th>{"".join(f"<td class=num>{t}</td>" for t in k_labels)}</tr>',
                    ],
                    "Below zero, fewer people in poverty." + (" " + WITHHELD_NOTE if None in k_vals else ""),
                    cls="compact",
                    after=self.explain(read),
                )
            )
            rows = []
            for key, label in (("abs_ahc", "Absolute, after housing costs"), ("rel_bhc", "Relative, before housing costs"), ("rel_ahc", "Relative, after housing costs")):
                _, a = self.cell(c, "poverty_inequality", f"poverty_{key}_change_pp", {"year": y}, "pp2", S + "-table")
                _, ap = self.cell(c, "poverty_inequality", f"poverty_{key}_change_pct", {"year": y}, "pct2", S + "-table")
                _, k = self.cell(c, "poverty_inequality", f"child_poverty_{key}_change_pp", {"year": y}, "pp2", S + "-table")
                _, kp = self.cell(c, "poverty_inequality", f"child_poverty_{key}_change_pct", {"year": y}, "pct2", S + "-table")
                rows.append(f'<tr><th scope="row">{label}</th><td class="num">{a}</td><td class="num">{ap}</td><td class="num">{k}</td><td class="num">{kp}</td></tr>')
            blocks.append(
                self.table(
                    f"{T}: change in other measures of poverty",
                    f"UK, {fy(y)}",
                    '<th scope="col">Poverty measure</th><th scope="col" class="num">All people, pp</th><th scope="col" class="num">All people, % of rate</th><th scope="col" class="num">Children, pp</th><th scope="col" class="num">Children, % of rate</th>',
                    rows,
                    "pp: percentage points. % of rate: the change as a share of the baseline poverty rate.",
                )
            )
            _, g = self.cell(c, "metrics", "gini_change", {"year": y}, "pct2", S + "-table", "x100")
            _, t10 = self.cell(c, "poverty_inequality", "top_10_share_change_pp", {"year": y}, "pp2", S + "-table")
            _, p9010 = self.cell(c, "poverty_inequality", "p90_p10_change", {"year": y}, "pct2", S + "-table", "x100")
            blocks.append(
                self.table(
                    f"{T}: change in inequality",
                    f"UK, {fy(y)}",
                    '<th scope="col">Inequality measure</th><th scope="col" class="num">Change</th>',
                    [
                        f'<tr><th scope="row">Gini index, relative change</th><td class="num">{g}</td></tr>',
                        f'<tr><th scope="row">Share of income of the top 10%, percentage points</th><td class="num">{t10}</td></tr>',
                        f'<tr><th scope="row">90/10 ratio, relative change</th><td class="num">{p9010}</td></tr>',
                    ],
                    "Equivalised household net income, each household weighted by the people in it. A relative change is a share of the baseline value: a Gini of 0.300 falling to 0.297 is a 1.00% fall.",
                )
            )
        if not self.single:
            rows = []
            for k in self.order:
                e = self.pub.measures[k]
                _, a = self.cell(e, "poverty_inequality", "poverty_abs_bhc_change_pp", {"year": y}, "pp2", S + "-measures")
                _, kk = self.cell(e, "poverty_inequality", "child_poverty_abs_bhc_change_pp", {"year": y}, "pp2", S + "-measures")
                _, r = self.cell(e, "poverty_inequality", "poverty_rel_ahc_change_pp", {"year": y}, "pp2", S + "-measures")
                _, g = self.cell(e, "metrics", "gini_change", {"year": y}, "pct2", S + "-measures", "x100")
                rows.append(f'<tr><th scope="row">{esc(e.name)}</th><td class="num">{a}</td><td class="num">{kk}</td><td class="num">{r}</td><td class="num">{g}</td></tr>')
            blocks.append(
                self.table(
                    "Each measure on its own: poverty and inequality",
                    f"UK, {fy(y)}",
                    '<th scope="col">Measure</th><th scope="col" class="num">Absolute BHC, pp</th><th scope="col" class="num">Children, absolute BHC, pp</th><th scope="col" class="num">Relative AHC, pp</th><th scope="col" class="num">Gini, relative change</th>',
                    rows,
                    runs="each",
                )
            )
        return self.section("poverty", "Poverty and inequality", intro, blocks)

    def age(self):
        c, y, S = self.pub.combined, self.year, "age"
        intro = (
            f"<p>The change in the net income of the households people live in, by the person's age, in {fy(y)}. Household income is shared by everyone in the household"
            + self.fn('"65 and over" is an age band, not the same group as people over State Pension age; the dashboard\'s pensioners view shows that group.')
            + ".</p>"
        )
        if c is None:
            return self.section("age", "By age", intro, [self.no_combined()])
        mv, ml, rows = [], [], []
        withheld = False
        for band, label in AGE_BANDS:
            v, t = self.cell(c, "age_impact", "mean_change", {"year": y, "age_band": band}, "gbp", S)
            mv.append(v)
            ml.append(WITHHELD if v is None else t)
            bv, b = self.cell(c, "age_impact", "pct_better_off", {"year": y, "age_band": band}, "pct1_plain", S)
            uv, u = self.cell(c, "age_impact", "pct_unchanged", {"year": y, "age_band": band}, "pct1_plain", S)
            wv, w = self.cell(c, "age_impact", "pct_worse_off", {"year": y, "age_band": band}, "pct1_plain", S)
            if None in (bv, uv, wv):
                b = u = w = WITHHELD
                withheld = True
            rows.append(f'<tr><th scope="row">{esc(label)}</th><td class="num">{b}</td><td class="num">{u}</td><td class="num">{w}</td></tr>')
        labels = [label for _, label in AGE_BANDS]
        chart = self._bar_chart(labels, mv, ml, [tone(v or 0.0) for v in mv], height=1.5)
        alt = "; ".join(f"{lab}: {m}" for lab, m in zip(labels, ml))
        names = [f"for people aged {lab.lower()}" if lab[0].isdigit() else f"for people {lab.lower()}" for lab in labels]
        title = self._spread_title(mv, names, "age group", "People")
        sig = [i for i, v in enumerate(mv) if v is not None]
        why = ""
        if sig and all(mv[i] >= 0.5 for i in sig):
            lo = min(sig, key=lambda i: mv[i])
            why = self.explain(f"People {'aged ' if labels[lo][0].isdigit() else ''}{esc(labels[lo].lower())} gain least on average. Each person is given their whole household's change, so the figures reflect the households people of each age live in.")
        blocks = [
            self.figure(chart, title, f"Average change in the net income of people's households, by age, £ a year, UK, {fy(y)}", alt, self._withheld_note(mv), after=why),
            self.table(
                f"{self.together}: people better off, unchanged and worse off by age",
                f"% of people, UK, {fy(y)}",
                '<th scope="col">Age</th><th scope="col" class="num">Better off</th><th scope="col" class="num">No change</th><th scope="col" class="num">Worse off</th>',
                rows,
                WITHHELD_NOTE if withheld else "",
            ),
        ]
        return self.section("age", "By age", intro, blocks)

    def areas_published(self):
        return self.pub.flat("constituency.csv") is not None or self.pub.flat("regional.csv") is not None

    def areas(self):
        con = self.pub.flat("constituency.csv")
        reg = self.pub.flat("regional.csv")
        if con is None and reg is None:
            return ""  # left out; the method annex says so
        blocks = []
        if reg is not None:
            blocks.append(self._regions(reg))
        if con is not None:
            blocks.append(self._constituencies(con))
        intro = "<p>The average change in household net income by area. Estimates for small areas rest on fewer survey households and are less certain; cells with too few are withheld.</p>"
        return self.section("areas", "Regions and constituencies", intro, blocks)

    def _area_key(self, rows):
        """The run to map: the combined run if published by area, else none."""
        keys = {r["reform"] for r in rows}
        c = self.pub.combined
        if c is not None and c.key in keys:
            return c.key, "All measures together"
        return None, None

    def _regions(self, path):
        y, S = self.year, "areas"
        rows = [r for r in read_csv(path) if str(r.get("year")) == str(y) and r.get("outcome") == "average_change"]
        key, label = self._area_key(rows)
        keys = [key] if key else [k for k in self.order if any(r["reform"] == k for r in rows)]
        head = '<th scope="col">Region</th>' + "".join(f'<th scope="col" class="num">{esc(self.name(k) if k in self.pub.measures else label)}</th>' for k in keys)
        regions = sorted({(r["area_code"], r["area_name"]) for r in rows}, key=lambda a: a[1])
        body = []
        for code, name in regions:
            cells = []
            for k in keys:
                r = next((r for r in rows if r["reform"] == k and r["area_code"] == code), None)
                if r is None or r.get("value", "") == "" or r.get("tier") == "withheld":
                    cells.append('<td class="num">withheld</td>')
                    continue
                v = float(r["value"])
                cells.append(f'<td class="num">{self.t.fig(v, "gbp", path, "value", {"reform": k, "year": y, "area_code": code, "outcome": "average_change"}, section=S)}</td>')
            body.append(f'<tr><th scope="row">{esc(name)}</th>{"".join(cells)}</tr>')
        return self.table("Average change in household net income by region", f"£ a year, {fy(y)}", head, body, runs="combined" if key else "each", cls="compact")

    def _constituencies(self, path):
        y, S, plt = self.year, "areas", self.plt
        rows = [r for r in read_csv(path) if str(r.get("year")) == str(y) and r.get("outcome") == "relative_change"]
        key, label = self._area_key(rows)
        if key is None:
            # The two measures whose effect varies most from seat to seat
            spread = {}
            for k in self.order:
                vs = [float(r["value"]) for r in rows if r["reform"] == k and r.get("value", "") != ""]
                if len(vs) > 10:
                    spread[k] = max(vs) - min(vs)
            keys = sorted(spread, key=lambda k: -spread[k])[:2]
        else:
            keys = [key]
        if not keys:
            return self.unavailable("No constituency figures for this year.")
        geo_path = REPO / "public" / "data" / "uk_constituencies_2024.geojson"
        if not geo_path.exists():
            geo_path = self.pub.data / "uk_constituencies_2024.geojson"
        geo = json.loads(geo_path.read_text())
        from matplotlib.collections import PatchCollection
        from matplotlib.colors import Normalize
        from matplotlib.patches import Polygon as MplPolygon
        from matplotlib.ticker import FuncFormatter

        fig, axes = plt.subplots(1, len(keys), figsize=(3.3 * len(keys), 4.4), squeeze=False)
        notes = []
        for ax, k in zip(axes[0], keys):
            seats = {r["area_code"]: r for r in rows if r["reform"] == k}
            shown = {c: float(r["value"]) * 100 for c, r in seats.items() if r.get("value", "") != "" and r.get("tier") != "withheld"}
            # The dashboard map's scale (src/utils/geography/scale.js): amber through
            # the light grey of no change to teal, continuous, fixed at -1% to +1%
            # (clamped at its ends), the same for every map; no data in slate grey.
            norm, cmap = Normalize(-MAP_EXTENT_PCT, MAP_EXTENT_PCT, clip=True), _map_cmap()
            patches, faces = [], []
            for feature in geo["features"]:
                code = feature["properties"]["GSScode"]
                g = feature["geometry"]
                rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
                face = MAP_NO_DATA if code not in shown else cmap(norm(shown[code]))
                for ring in rings:
                    patches.append(MplPolygon(ring[::3] if len(ring) > 60 else ring, closed=True))
                    faces.append(face)
            ax.add_collection(PatchCollection(patches, facecolor=faces, edgecolor="#FFFFFF", linewidth=0.08))
            ax.autoscale_view()
            ax.set_aspect("equal")
            ax.axis("off")
            title = label if k == key else self.name(k)
            ax.set_title(title, fontsize=8.6, color=INK)
            withheld = len(seats) - len(shown)
            notes.append(
                f"{esc(title)}: {self.t.fig(len(shown), 'count', path, 'value', {'reform': k, 'year': y, 'outcome': 'relative_change', 'tier': '!withheld'}, 'count', S)} seats shown, "
                f"{self.t.fig(withheld, 'count', path, 'value', {'reform': k, 'year': y, 'outcome': 'relative_change', 'tier': 'withheld'}, 'count', S)} withheld"
            )
        # One key for every map: the scale is fixed, the same for each (as on the dashboard)
        fig.tight_layout(w_pad=1.0, rect=(0, 0.1, 1, 1))
        cax = fig.add_axes([0.3, 0.05, 0.4, 0.022])
        cbar = fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal", ticks=[-MAP_EXTENT_PCT, 0, MAP_EXTENT_PCT])
        cbar.ax.tick_params(labelsize=7.5, length=0)
        cbar.ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: "0%" if v == 0 else f"{'+' if v > 0 else MINUS}{abs(v):g}%"))
        cbar.ax.set_title("Change in household net income, % of income", fontsize=7.5, color=TEXT, pad=3)
        cbar.outline.set_visible(False)
        png = png_of(plt, fig, dpi=170)
        plain = "; ".join(re.sub("<[^>]+>", "", n) for n in notes)
        return self.figure(
            png,
            "The change in household net income varies from constituency to constituency",
            f"Average change in household net income by Westminster constituency (2024 boundaries), % of net income, {fy(y)}",
            "Map of constituencies. " + plain + ".",
            "Colour scale as on the dashboard map, from −1% to +1%, the same for every map here; seats beyond either end take its end colour. Slate grey: no data (withheld, where the estimate is too uncertain or could disclose survey records). " + plain + ". Every measure is published by constituency on the dashboard.",
            runs="combined" if key else "each",
            img=True,
        )

    def households(self):
        c, y, S, plt = self.pub.combined, self.year, "households", self.plt
        intro_base = "Each is one household, not an average; real households differ in rent, spending and circumstances."
        if c is None:
            return self.section("households", "Example households", f"<p>{intro_base}</p>", [self.no_combined()])
        defs = {h["id"]: h for h in self.contract.get("income_curve_households", [])}
        rows = [r for r in c.table("income_curve") if str(r["year"]) == str(y)]
        ids = [h for h in defs if any(r["household"] == h for r in rows)] or sorted({r["household"] for r in rows})
        if not ids:
            return self.section("households", "Example households", f"<p>{intro_base}</p>", [self.unavailable("No example households are published for this year.")])
        n = len(ids)
        who = esc(self.together) + " changes" if self.single else "the measures together change"
        intro = f"<p>How {who} the net income of {count_words(n)} example household{'s' if n != 1 else ''} in {fy(y)}, at different incomes. {intro_base}</p>"
        cols = min(n, 2)
        nrows = (n + cols - 1) // cols
        # One vertical scale for every chart, so the households can be compared by eye
        fig, axes = plt.subplots(nrows, cols, figsize=(COL_W, 1.4 * nrows), squeeze=False, sharey=True, layout="constrained")
        shares = (0.2, 0.4, 0.8)
        table_rows = []
        signs = []
        per_h = {}
        all_ch = [0.0]
        singles = []
        spikes = []  # (household, rows on the curve, index of a single point far outside the rest)
        for i, h in enumerate(ids):
            ax = axes[i // cols][i % cols]
            hr = sorted((r for r in rows if r["household"] == h), key=lambda r: float(r["income"]))
            xs = [float(r["income"]) / 1000 for r in hr]
            ch = [float(r["reform_net_income"]) - float(r["baseline_net_income"]) for r in hr]
            # Single points far from the rest are cut from the shared scale;
            # every single-point spike over £500 is described in the text
            out = isolated_points(ch, factor=3)
            singles += [(h, hr, j) for j in isolated_points(ch, factor=0)]
            spikes += [(h, hr, j) for j in out]
            all_ch += [v for j, v in enumerate(ch) if j not in out]
            ax.plot(xs, ch, color=HIGHLIGHT, linewidth=1.7)
            ax.axhline(0, color=ZERO, linewidth=0.7)
            ax.fill_between(xs, ch, 0, where=[v >= 0 for v in ch], color=GAIN, alpha=0.18, linewidth=0)
            ax.fill_between(xs, ch, 0, where=[v < 0 for v in ch], color=LOSS, alpha=0.25, linewidth=0)
            d = defs.get(h, {})
            ax.set_title(d.get("label", h), fontsize=9, loc="left", color=INK, fontweight="semibold")
            ax.set_xlabel(f"{d.get('x_label', 'Income')}, £k", fontsize=8)
            ax.tick_params(labelsize=8)
            minus_ticks(ax)
            style_axes(ax)
            cells = []
            top = float(d.get("x_max") or max(float(r["income"]) for r in hr))
            for share in shares:
                p = top * share
                r = min(hr, key=lambda r: abs(float(r["income"]) - p))
                if abs(float(r["income"]) - p) > 1:
                    cells.append('<td class="num">n/a</td>')
                    continue
                v = float(r["reform_net_income"]) - float(r["baseline_net_income"])
                signs.append(v)
                text = self.t.fig(v, "gbp", c.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
                cells.append(f'<td class="num {self._tone_cls(v)}">{text}<div class="at">at £{float(r["income"]):,.0f}</div></td>')
                per_h.setdefault(h, []).append(round(v))
            table_rows.append(f'<tr><th scope="row">{esc(d.get("label", h))}<div class="def">{esc(self._definition(d))}</div></th>{"".join(cells)}</tr>')
        lo, hi = min(all_ch), max(all_ch)
        span = (hi - lo) or 10
        top = hi + span * 0.15
        axes[0][0].set_ylim(lo - span * 0.15, top)
        for h, hr, j in spikes:
            # A point off the shared scale: the line runs to the top edge, marked there
            ax = axes[ids.index(h) // cols][ids.index(h) % cols]
            x = float(hr[j]["income"]) / 1000
            ax.plot([x], [top], marker="^", color=HIGHLIGHT, markersize=6, clip_on=False, zorder=5)
            ax.annotate("off scale, see text", (x, top), xytext=(5, -9), textcoords="offset points", fontsize=7.5, color=MUTED)
        for j in range(n, nrows * cols):
            axes[j // cols][j % cols].axis("off")
        if signs and all(v >= 0.5 for v in signs):
            title = "Every example household is better off at each of the three incomes in the table"
        elif signs and all(v <= -0.5 for v in signs):
            title = "Every example household is worse off at each of the three incomes in the table"
        else:
            title = "How the change in net income varies with income differs from household to household"
        read = ""
        flat = [h for h, vs in per_h.items() if len(vs) == 3 and len(set(vs)) == 1]
        if per_h:
            label = lambda h: esc(defs.get(h, {}).get("label", h))  # noqa: E731
            varies = [h for h in per_h if h not in flat]
            if len(flat) == len(per_h):
                read = "For every example household the change is the same at all three incomes: across the range of incomes shown, it does not vary with income."
            elif flat:
                if len(varies) == 1:
                    other = label(varies[0])
                    other = f"for the {other[0].lower() + other[1:]} it varies"
                else:
                    other = "for the others it varies"
                read = f"The change is the same at all three incomes for {count_words(len(flat))} of the {count_words(len(per_h))} households ({self._names([label(h) for h in flat])}); {other} with income, as its chart shows." if len(varies) == 1 else f"The change is the same at all three incomes for {count_words(len(flat))} of the {count_words(len(per_h))} households ({self._names([label(h) for h in flat])}); {other} with income, as the charts show."
            else:
                read = "For every example household the change varies with income, as the charts show."
        read = " ".join(t for t in [read, *(self._spike_text(h, hr, j, defs.get(h, {}), first=i == 0, off=(h, hr, j) in spikes) for i, (h, hr, j) in enumerate(singles))] if t)
        blocks = [
            self.figure(svg_of(plt, fig), title, f"Change in net income by income, {count_words(n)} example household{'s' if n != 1 else ''}, £ a year, {fy(y)}", "Line charts of the change in each household's net income as its income varies; the table below gives the values at three incomes.", "The horizontal axis is the income named under each chart, before tax; all charts share one vertical scale"
                + ("; a single point far outside it is cut at the top edge and marked with a triangle" if spikes else "")
                + ". Households as defined on the dashboard.", after=self.explain(read)),
            self.table(
                f"{self.together}: change in net income at three incomes",
                f"£ a year, {fy(y)}",
                '<th scope="col">Household</th>' + "".join(f'<th scope="col" class="num">{lab}</th>' for lab in ("Lower income", "Middle income", "Higher income")),
                table_rows,
                "Lower, middle and higher income: 20%, 40% and 80% of the top of each household's income range on the dashboard.",
                cls="households",
            ),
        ]
        return self.section("households", "Example households", intro, blocks)

    def _spike_text(self, h, hr, j, d, first=True, off=False):
        """Says what a single off-scale point on an example household's curve is,
        from the curve itself: the change there, and where current law and the
        measures each have their step in net income, if that is what it is."""
        c, y, S = self.pub.combined, self.year, "households"
        label = d.get("label", h)
        label = label[0].lower() + label[1:]
        what = (d.get("x_label") or "income").lower()
        r = hr[j]
        inc = float(r["income"])
        val = float(r["reform_net_income"]) - float(r["baseline_net_income"])
        at = lambda row: self.t.fig(float(row["income"]), "gbp_plain", c.path("income_curve"), "income", {"reform_id": c.key, "year": y, "household": h, "income": row["income"]}, "value", S)  # noqa: E731
        change = self.t.fig(val, "gbp", c.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": c.key, "year": y, "household": h, "income": r["income"]}, "value", S)
        where = " (cut at the top of the scale)" if off else ""
        if first:
            text = (
                f"The spike on the chart for the {esc(label)}{where} is one point of the published curve, not a drawing error: "
                f"at {at(r)} of {esc(what)} its net income changes by {change}, far more than at the incomes either side."
            )
        else:
            text = f"The {esc(label)}'s chart has a smaller spike{where} at {at(r)} of {esc(what)}: {change}."
        b = [float(x["baseline_net_income"]) for x in hr]
        f = [float(x["reform_net_income"]) for x in hr]
        if 0 < j < len(hr) - 1:
            step_b, step_f = b[j + 1] - b[j], f[j] - f[j - 1]
            usual = sorted(abs(b[k + 1] - b[k]) for k in range(len(b) - 1))[len(b) // 2]
            if step_b * val > 0 and step_f * val > 0 and min(abs(step_b), abs(step_f)) > 5 * max(usual, 1) and not first:
                text += " It has the same cause: a step in net income that comes one point earlier with the measures."
            elif step_b * val > 0 and step_f * val > 0 and min(abs(step_b), abs(step_f)) > 5 * max(usual, 1):
                text += (
                    f" Under current law the household's net income {'jumps up' if step_b > 0 else 'drops'} between {at(r)} and {at(hr[j + 1])}; "
                    f"with the measures the same {'jump' if step_b > 0 else 'drop'} comes between {at(hr[j - 1])} and {at(r)}, "
                    "one point earlier on the curve, so the two differ by the size of that step at this one income only."
                )
        if not self.single:
            best = None
            for k in self.order:
                e = self.pub.measures[k]
                mr = e.row("income_curve", year=y, household=h, income=r["income"])
                if mr is None:
                    continue
                mv = float(mr["reform_net_income"]) - float(mr["baseline_net_income"])
                if best is None or abs(mv) > abs(best[1]):
                    best = (k, mv)
            if best is not None and abs(best[1]) > abs(val) / 2:
                e = self.pub.measures[best[0]]
                own = self.t.fig(best[1], "gbp", e.path("income_curve"), "reform_net_income-baseline_net_income", {"reform_id": e.key, "year": y, "household": h, "income": r["income"]}, "value", S)
                text += f" {esc(self.name(best[0]))} on its own gives {own} there."
        return text

    @staticmethod
    def _definition(d):
        """The household as defined, without what it says about measures the
        dashboard can select. A clause that joins the household's own facts
        to such a measure with ", and " keeps the facts before it."""
        kept = []
        for cl in d.get("definition", "").split("; "):
            if "when selected" not in cl:
                kept.append(cl)
                continue
            head = cl[: cl.index("when selected")]
            if ", and " in head:
                kept.append(head[: head.rindex(", and ")])
        text = "; ".join(kept).strip().rstrip(".")
        return text + "."

    def measures_table(self):
        """Table 1: the measures as modelled, in the order used throughout,
        then any modelled but left out, in the report's own words."""
        rows, statuses = [], set()
        for k in self.order:
            e = self.pub.measures[k]
            status = "Provisional" if e.status == "provisional" else "Approved"
            extra = ""
            if e.unsupported:
                extra = f' <span class="muted">No figures for {", ".join(fy(y) for y in e.unsupported)}.</span>'
            rec = (e.entry.get("reconciliation") or {}).get("summary_status")
            rec_text = {"pass": "matches the Treasury costing within tolerance", "awaiting_source": "Treasury costing not yet published"}.get(rec, (rec or "").replace("_", " "))
            statuses.add((status, rec_text))
            rows.append((e.name, f"{esc(e.description)}{extra}", status, rec_text))
        same = len(statuses) == 1
        if same:
            head = '<th scope="col">Measure</th><th scope="col">What it does, as modelled</th>'
            body = [f'<tr><th scope="row">{esc(nm)}</th><td>{d}</td></tr>' for nm, d, _, _ in rows]
            status, rec_text = next(iter(statuses))
            notes = f"Status of every measure: {status.lower()}" + (f"; {esc(rec_text)}." if rec_text else ".")
        else:
            head = '<th scope="col">Measure</th><th scope="col">What it does, as modelled</th><th scope="col">Status</th>'
            body = [
                f'<tr><th scope="row">{esc(nm)}</th><td>{d}</td><td>{s}{"<br><span class=muted>" + esc(r[0].upper() + r[1:]) + "</span>" if r else ""}</td></tr>'
                for nm, d, s, r in rows
            ]
            notes = ""
        n = len(self.order)
        out = [
            f'<h3>The measures</h3><p>The {count_words(n)} measure{"s" if n != 1 else ""} in this report. Measures not listed here are not in this report.</p>',
            self.table(
                "The measures in this report",
                "As modelled; those that raise revenue first, then those that cost it, each by size over the years published. This order is used throughout.",
                head,
                body,
                notes,
                runs=None,
                cls="measures" + (" nostatus" if same else ""),
                keep=False,
            ),
        ]
        if self.pub.not_shown:
            items = []
            for k, e in self.pub.not_shown:
                reason = NOT_SHOWN_REASONS.get(e["status"], e["status"].replace("_", " "))
                when = re.search(r"\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b", e.get("reason") or "")
                if when and e["status"] == "withdrawn":
                    reason += f" on {when.group(1)}"
                items.append(f"<li><b>{esc(e.get('name') or k)}</b>: {esc(reason)}</li>")
            out.append(f'<div class="keep"><h3>Modelled but not in this report</h3><ul>{"".join(items)}</ul></div>')
        return "".join(out)

    def method(self):
        m = self.pub.manifest
        ident = (m.get("execution") or {}).get("identity") or {}
        data = ident.get("data") or {}
        basis = m.get("basis") or {}
        fc = basis.get("forecast") or {}
        versions = ", ".join(f"{ident[k]['name']} {ident[k]['version']}" for k in ("wrapper", "model", "core") if k in ident)
        forecast = (
            "The economic assumptions are the model's pre-Budget ones; they have not yet been rebased on the Budget's OBR forecast."
            if fc.get("status") == "pre_budget"
            else f"Economic assumptions: {esc(fc.get('source', ''))} ({esc(fc.get('vintage', ''))})."
        )
        areas = "" if self.areas_published() else "<li><b>Areas.</b> Results by region and constituency are not yet published in this release; they will be added to this report once they are.</li>"
        commit = ""
        try:
            commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
            dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--untracked-files=no", "--", "report/", "src/utils/publication/contract.json"], capture_output=True, text=True, check=True).stdout.strip()
            if commit and dirty:
                commit += " with uncommitted changes"
        except Exception:
            pass
        intro = f"""<h3>Model and data</h3>
<p>Model: {esc(versions)}, on the {esc(data.get('dataset', ''))} dataset (build {esc(data.get('build_id', ''))}). {self._runs_sentence()}, for {fy(self.years[0])} to {fy(self.years[-1])}. {forecast}</p>"""
        blocks = [
            f"""<div class="keep"><h3>What the figures leave out</h3>
<ul>
<li><b>Static costings.</b> The figures are not the OBR's post-behavioural costings (see the glossary).</li>
<li><b>Survey data.</b> Incomes and spending come from household survey data calibrated to official totals; estimates for small groups and small areas are uncertain, and cells with too few survey households are withheld.</li>
<li><b>Living standards outlook.</b> The dashboard's outlook for household incomes rests on a separate baseline forecast that is not one of this publication's receipted artifacts, so this report does not reproduce it.</li>
{areas}
</ul></div>""",
            f"""<div class="keep"><h3>Provenance</h3>
<p>Publication manifest revision {esc(m.get('revision', ''))}, updated {esc(long_date(m.get('updated_at', '')))}. Every figure in this report is traced, with the file, row and column it came from, in the accompanying <code>figures.json</code>, and each artifact's files were checked against its receipt when this report was built by <code>report/build_report.py</code>{' at ' + esc(commit) if commit else ''}.</p></div>""",
        ]
        return self.section("method", "Methodology and caveats", intro, blocks, annex="A")

    def glossary(self):
        terms = [
            ("Absolute poverty", "Household income below 60% of the 2024-25 median, held fixed in real terms."),
            ("Relative poverty", "Household income below 60% of the median in the same year."),
            ("BHC, AHC", "Before housing costs and after housing costs: income measured before or after rent, mortgage interest and similar costs are taken off."),
            ("Combined run", "One simulation of all the measures in the report at once, which captures how they interact. Figures for the measures together come only from it, never from adding up measures."),
            ("Decile", "One of ten equal groups of households, ranked by equivalised household net income before the measures."),
            ("Equivalised income", "Household income adjusted for the size and make-up of the household, so that households of different sizes can be compared."),
            ("Gini index", "A measure of income inequality from 0 (everyone has the same income) to 1 (one household has all income). Shown here as a relative change."),
            ("Net income", "Household income after taxes and including benefits."),
            ("pp", "Percentage points: the difference between two percentages."),
            ("Provisional", "Figures published before they are approved: for candidate measures, modelled before the Budget; on Budget day, statement figures awaiting the Treasury costing."),
            ("Static costing", "A costing in which people do not change their behaviour in response to the measures."),
            ("90/10 ratio", "The income of the household at the 90th percentile divided by that at the 10th."),
        ]
        rows = "".join(f"<div><dt>{esc(t)}</dt><dd>{esc(d)}</dd></div>" for t, d in terms)
        return self.section("glossary", "Glossary", "", [f'<dl class="glossary">{rows}</dl>'], annex="B")

    def _runs_sentence(self):
        if self.single:
            return "The measure is simulated against current law"
        if self.pub.combined is None:
            return "Each measure is simulated on its own against current law; no combined run covers exactly these measures"
        return "Each measure is simulated on its own against current law, and all of them together in one combined run"

    def _header_right(self) -> str:
        budget_date = (self.pub.manifest.get("budget") or {}).get("date", "")
        return f"Budget {long_date(budget_date)}" if budget_date else "PolicyEngine UK"

    def _header_logo(self) -> str:
        """The logo for the running header: the cover's PNG wrapped in an SVG
        that sets its printed size (a margin box cannot size an image), as a
        data URL followed by a gap before the title. Empty without the logo."""
        path = REPO / "public" / "assets" / "logos" / "policyengine-teal.png"
        if not path.exists():
            return ""
        png = base64.b64encode(path.read_bytes()).decode()
        # 996 x 207 px; 2.6mm high, about the height of the 7pt header text
        h = 2.6
        w = round(h * 996 / 207, 2)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}mm" height="{h}mm" viewBox="0 0 996 207">'
            f'<image width="996" height="207" xlink:href="data:image/png;base64,{png}"/></svg>'
        )
        return f'url("data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}") "\\2003" '

    def page_css(self) -> str:
        """Running header and footer, as @page margin boxes (Chrome 131 and later)."""
        font = 'font-family: Inter, "Helvetica Neue", Arial, sans-serif; font-size: 7pt; color: #4B5563;'
        left_foot = f"PolicyEngine · {self.pub.provisional_label}" if self.pub.provisional else "PolicyEngine"
        return f"""
@page {{
  @top-left {{ content: {self._header_logo()}{css_string(self.title)}; {font} font-weight: 600; color: #285E61; vertical-align: bottom; padding-bottom: 3mm; }}
  @top-right {{ content: {css_string(self._header_right())}; {font} vertical-align: bottom; padding-bottom: 3mm; }}
  @bottom-left {{ content: {css_string(left_foot)}; {font} vertical-align: top; padding-top: 3mm; }}
  @bottom-right {{ content: "Page " counter(page) " of " counter(pages); {font} vertical-align: top; padding-top: 3mm; }}
}}
@page :first {{
  @top-left {{ content: none; }} @top-right {{ content: none; }} @bottom-left {{ content: none; }} @bottom-right {{ content: none; }}
}}"""

    def build(self) -> str:
        self._toc = []
        # Sections first, so the contents (in the key findings page) can list
        # only the sections that are present, with their numbers.
        # The introduction is section 1; it refers to later sections by number.
        later = ["revenue", "deciles", "winners", "poverty", "age", "areas", "households"]
        present = [sid for sid in later if sid != "areas" or self.areas_published()]
        self._secnums = {sid: str(i + 2) for i, sid in enumerate(present)}
        sections = [self.introduction(), self.revenue(), self.deciles(), self.winners(), self.poverty(), self.age(), self.areas(), self.households()]
        annexes = [self.method(), self.glossary()]
        for s in sections + annexes:
            if not s:
                continue
            sid = re.search(r'id="([^"]+)"', s).group(1)
            num = re.search(r'<p class="secnum">([^<]+)</p><h2>([^<]+)</h2>', s)
            self._toc.append((sid, html.unescape(num.group(1)), html.unescape(num.group(2))))
        cover = self.cover()
        summary = self.key_findings()
        body = [cover, summary] + [s for s in sections if s] + annexes
        watermark = '<div class="watermark" aria-hidden="true">Provisional</div>' if self.pub.provisional else ""
        css = (HERE / "report.css").read_text()
        fonts = "".join(
            f"@font-face{{font-family:Inter;font-style:normal;font-weight:{w};src:url(data:font/woff2;base64,"
            f"{base64.b64encode((HERE / 'fonts' / f'inter-latin-{w}-normal.woff2').read_bytes()).decode()}) format('woff2');}}"
            for w in (400, 600, 700)
        )
        return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>{esc(self.title)}</title>
<meta name="author" content="PolicyEngine">
<meta name="description" content="{esc(self.title)}: figures for {fy(self.year)} from publication manifest revision {esc(self.pub.manifest.get('revision', ''))}">
<style>{fonts}
{css}
{self.page_css()}</style></head><body>
{watermark}
{''.join(body)}
</body></html>"""


def to_pdf(html_path: Path, pdf_path: Path, chrome: str | None):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        kwargs = {"executable_path": chrome} if chrome else {"channel": "chrome"}
        browser = p.chromium.launch(**kwargs)
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri(), wait_until="load")
        page.evaluate("document.fonts.ready")
        # The running header and footer are the stylesheet's @page margin boxes.
        page.pdf(
            path=str(pdf_path),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            display_header_footer=False,
            tagged=True,
            outline=True,
        )
        browser.close()


# --- Check --------------------------------------------------------------


def check(figures_path: Path, data: Path) -> int:
    """Recompute every traced figure from its file and compare the text."""
    items = json.loads(figures_path.read_text())["figures"]
    cache = {}
    bad = 0
    for item in items:
        path = data / item["file"]
        if path not in cache:
            cache[path] = read_csv(path)
        where = item["where"]

        def matches(r):
            for k, v in where.items():
                if k == "year" and isinstance(v, list):
                    if int(r["year"]) not in v:
                        return False
                elif isinstance(v, str) and v.startswith("!"):
                    if r.get(k) == v[1:]:
                        return False
                elif str(r.get(k)) != str(v):
                    return False
            return True

        rows = [r for r in cache[path] if matches(r)]
        if item["transform"] == "count":
            if item["where"].get("tier") == "!withheld":
                rows = [r for r in rows if r.get("value", "") != ""]
            value = float(len(rows))
        else:
            col = item["column"]
            if "-" in col:
                a, b = col.split("-")
                xs = [float(r[a]) - float(r[b]) for r in rows]
            else:
                xs = [float(r[col]) for r in rows]
            years = where.get("year") if isinstance(where.get("year"), list) else None
            if not xs or (item["transform"] != "sum" and len(xs) != 1) or (years is not None and len(xs) != len(years)):
                print(f"NO UNIQUE ROW: {item}")
                bad += 1
                continue
            value = TRANSFORMS[item["transform"]](xs)
        text = FORMATS[item["format"]](value)
        if text != item["text"]:
            print(f"MISMATCH: printed {item['text']!r}, data give {text!r}: {item['file']} {where} {item['column']}")
            bad += 1
    print(f"{len(items)} figures checked, {bad} problems")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="write report.html, figures.json and (with --pdf) report.pdf")
    b.add_argument("--data", type=Path, default=REPO / "public" / "data")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--year", type=int, default=DEFAULT_YEAR, help="first year of the fiscal year to report (default 2027: 2027-28)")
    b.add_argument("--title", default="Autumn Budget 2026: the measures modelled")
    b.add_argument("--pdf", action="store_true", help="print report.pdf with Chrome (needs playwright)")
    b.add_argument("--chrome", default=None, help="a Chrome or Chromium executable (default: the installed Google Chrome)")
    c = sub.add_parser("check", help="recompute every figure in figures.json from the data")
    c.add_argument("figures", type=Path)
    c.add_argument("--data", type=Path, default=REPO / "public" / "data")
    args = ap.parse_args(argv)
    if args.cmd == "check":
        return check(args.figures, args.data)
    pub = Publication(args.data)
    report = Report(pub, args.year, args.title)
    html_text = report.build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.html").write_text(html_text)
    (args.out / "figures.json").write_text(
        json.dumps(
            {
                "manifest_revision": pub.manifest.get("revision"),
                "manifest_sha256": sha256(pub.manifest_path),
                "year": args.year,
                "provisional": pub.provisional,
                "figures": report.t.items,
            },
            indent=1,
            ensure_ascii=False,
        )
    )
    print(f"wrote {args.out / 'report.html'} and figures.json ({len(report.t.items)} figures)")
    if args.pdf:
        to_pdf(args.out / "report.html", args.out / "report.pdf", args.chrome)
        print(f"wrote {args.out / 'report.pdf'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
