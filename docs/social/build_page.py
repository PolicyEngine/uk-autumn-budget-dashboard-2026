"""Build docs/social/site/index.html from pre-budget-posts.md.

Run from the repo root: python3 docs/social/build_page.py
"""

import html
import re
from pathlib import Path

HERE = Path(__file__).parent
SOURCE = HERE / "pre-budget-posts.md"
OUT = HERE / "site" / "index.html"


def inline(text):
    """Escape text, then apply the markdown the drafts use: code, bold, links, bare URLs."""
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(
        r"\[([^\]]+)\]\((https?://[^)\s]+)\)",
        r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>',
        text,
    )
    text = re.sub(r"\[([^\]]+)\]\(#[^)]+\)", r"\1", text)
    text = re.sub(
        r'(?<![">])(https?://[^\s<)]+)',
        r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>',
        text,
    )
    return text


def blocks(lines):
    """Render plain markdown lines (paragraphs, bullets, tables) as HTML."""
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip() == "---":
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip("|").split("|")]
                if not all(set(c) <= set("-: ") for c in cells):
                    rows.append(cells)
                i += 1
            head = "".join(f"<th>{inline(c)}</th>" for c in rows[0])
            body = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
                for r in rows[1:]
            )
            out.append(f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        elif line.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(f"<li>{inline(lines[i][2:])}</li>")
                i += 1
            out.append(f"<ul>{''.join(items)}</ul>")
        else:
            cls = ' class="flag"' if re.match(r"\*\*(Check|Hold|Before)", line) else ""
            out.append(f"<p{cls}>{inline(line)}</p>")
            i += 1
    return "\n".join(out)


def post_card(title, lines):
    """Render one ### section: meta, X post, reply, LinkedIn post, notes."""
    meta, notes, x_text, li_text, reply = [], [], None, None, None
    i = 0
    while i < len(lines):
        line = lines[i]
        if line in ("**X**", "**LinkedIn**"):
            i += 1
            quote = []
            while i < len(lines) and (lines[i].startswith(">") or not lines[i].strip()):
                if lines[i].startswith(">"):
                    quote.append(lines[i][2:] if lines[i].startswith("> ") else "")
                i += 1
            text = "\n".join(quote).strip()
            if line == "**X**":
                x_text = text
            else:
                li_text = text
            continue
        if line.startswith("Reply: "):
            reply = line[len("Reply: "):].strip("`")
        elif x_text is None and line.strip():
            meta.append(line)
        elif line.strip():
            notes.append(line)
        i += 1

    def copy_box(label, text, count=False):
        counter = (
            f'<span class="count">{len(text)} / 280</span>' if count else ""
        )
        return (
            f'<div class="post"><div class="post-head"><span>{label}</span>{counter}'
            f'<button type="button" class="copy">Copy</button></div>'
            f'<pre>{html.escape(text)}</pre></div>'
        )

    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    parts = [f'<article class="card" id="{slug}"><h3>{inline(title)}</h3>', blocks(meta)]
    flags = [n for n in notes if re.match(r"\*\*(Check|Hold|Before)", n)]
    parts.append(blocks(flags))
    parts.append('<div class="pair">')
    if x_text:
        x_html = copy_box("X", x_text, count=True)
        if reply:
            x_html += copy_box("X reply", reply)
        parts.append(f"<div>{x_html}</div>")
    if li_text:
        parts.append(f"<div>{copy_box('LinkedIn', li_text)}</div>")
    parts.append("</div>")
    parts.append(f'<div class="notes">{blocks([n for n in notes if n not in flags])}</div>')
    parts.append("</article>")
    return "\n".join(parts)


def build():
    text = SOURCE.read_text()
    lines = text.split("\n")
    title = lines[0].lstrip("# ").strip()
    # Split into ## sections, each a list of ### posts or plain lines.
    sections, current = [], None
    for line in lines[1:]:
        if line.startswith("## "):
            current = {"title": line[3:], "intro": [], "posts": []}
            sections.append(current)
        elif line.startswith("### "):
            current["posts"].append({"title": line[4:], "lines": []})
        elif current is None:
            continue
        elif current["posts"]:
            current["posts"][-1]["lines"].append(line)
        else:
            current["intro"].append(line)

    intro = next(
        (l for l in lines[1:] if l.strip() and not l.startswith("#")), ""
    )
    body = [f"<header><h1>{inline(title)}</h1><p>{inline(intro)}</p></header>"]
    for s in sections:
        body.append(f'<section><h2>{inline(s["title"])}</h2>{blocks(s["intro"])}')
        body.extend(post_card(p["title"], p["lines"]) for p in s["posts"])
        body.append("</section>")

    page = TEMPLATE.replace("{{TITLE}}", html.escape(title)).replace(
        "{{BODY}}", "\n".join(body)
    )
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(page)
    print(f"Wrote {OUT}")


TEMPLATE = """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{{TITLE}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --teal: #319795; --teal-dark: #285e61; --teal-light: #e6fffa;
  --text: #374151; --muted: #4B5563; --border: #e2e8f0; --bg: #f7fafc;
  --card: #ffffff; --flag-bg: #fffbeb; --flag-border: #f59e0b;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font-family: Inter, system-ui, sans-serif; font-size: 15px; line-height: 1.55; }
header { background: var(--teal); color: #fff; padding: 32px 16px; }
header h1 { margin: 0 auto 8px; max-width: 1100px; font-size: 28px; font-weight: 700; }
header p { margin: 0 auto; max-width: 1100px; opacity: 0.92; }
section { max-width: 1100px; margin: 0 auto; padding: 24px 16px 8px; }
h2 { font-size: 20px; margin: 16px 0 12px; color: var(--teal-dark); }
h3 { font-size: 17px; margin: 0 0 6px; }
a { color: var(--teal-dark); overflow-wrap: anywhere; }
code { background: var(--teal-light); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; background: var(--card); margin: 8px 0 16px; }
th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: var(--teal-light); font-weight: 600; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  padding: 20px; margin: 0 0 20px; }
.card > p { margin: 0 0 8px; color: var(--muted); }
.flag { background: var(--flag-bg); border-left: 4px solid var(--flag-border);
  padding: 8px 12px; border-radius: 4px; color: var(--text) !important; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
@media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
.pair > div { min-width: 0; }
.table-wrap { overflow-x: auto; }
.post { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
.post-head { display: flex; align-items: center; gap: 10px; background: var(--teal-light);
  padding: 6px 10px; font-weight: 600; font-size: 13px; }
.post-head span:first-child { flex: 1; }
.count { font-weight: 500; color: var(--muted); }
.copy { font: inherit; font-size: 12px; border: 1px solid var(--teal); background: #fff;
  color: var(--teal-dark); border-radius: 4px; padding: 2px 10px; cursor: pointer; }
.copy:hover { background: var(--teal); color: #fff; }
pre { margin: 0; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: inherit; font-size: 14px; }
.notes p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
footer { max-width: 1100px; margin: 0 auto; padding: 16px 16px 40px; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
{{BODY}}
<footer>Drafts for review. Nothing here has been posted. Generated from docs/social/pre-budget-posts.md in PolicyEngine/uk-autumn-budget-dashboard-2026.</footer>
<script>
document.querySelectorAll(".copy").forEach(function (b) {
  b.addEventListener("click", function () {
    var text = b.closest(".post").querySelector("pre").innerText;
    navigator.clipboard.writeText(text).then(function () {
      b.textContent = "Copied";
      setTimeout(function () { b.textContent = "Copy"; }, 1500);
    });
  });
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
