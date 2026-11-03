"""Mark the outlook's public-file review row pending after a rewrite.

While sign-off is on (uk_budget_data/sign_off.py; the commands skip this
while it is off), every file under public/ needs a row in
data_inputs/public_data_review.csv with the sha256 of the bytes a person
reviewed. A rewrite of the outlook changes its bytes, so the command that
writes it puts its row back to ``pending``: it names who decides and by
when (at most 14 days on, as scripts/check_public_data.py allows), and
records the new sha256. It is not a sign-off. Every other row keeps its
bytes.
"""

import csv
import hashlib
import io
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

REVIEW_CSV = Path("data_inputs/public_data_review.csv")
PENDING_DAYS = 14
COLUMNS = (
    "path",
    "kind",
    "sha256",
    "reviewer",
    "reviewed_on",
    "expires_on",
    "basis",
)


def _row_text(values: list[str]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerow(values)
    return buffer.getvalue()


def set_pending(
    public_path: str,
    file_bytes: bytes,
    reviewer: str,
    basis: str,
    review_csv: Path = REVIEW_CSV,
    today: Optional[date] = None,
) -> None:
    """Replace (or add) the row for ``public_path`` as a pending review."""
    if "\n" in basis or "\r" in basis:
        raise ValueError("A review basis is one line.")
    today = today or date.today()
    values = [
        public_path,
        "pending",
        hashlib.sha256(file_bytes).hexdigest(),
        reviewer,
        today.isoformat(),
        (today + timedelta(days=PENDING_DAYS)).isoformat(),
        basis,
    ]
    text = review_csv.read_text()
    lines = text.splitlines(keepends=True)
    header = next(csv.reader([lines[0]]))
    if tuple(header) != COLUMNS:
        raise ValueError(f"{review_csv}: unexpected columns {header}")
    matches = [
        i for i, line in enumerate(lines) if line.startswith(public_path + ",")
    ]
    if len(matches) > 1:
        raise ValueError(f"{review_csv}: {public_path} has several rows")
    new = _row_text(values)
    if matches:
        i = matches[0]
        # The row must be one complete record on one line, so replacing the
        # line replaces the whole row and nothing else.
        if len(next(csv.reader([lines[i]]))) != len(COLUMNS):
            raise ValueError(f"{review_csv}: {public_path}'s row spans lines")
        lines[i] = new
    else:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(new)
    review_csv.write_text("".join(lines))
