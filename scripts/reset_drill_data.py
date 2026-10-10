"""Run the guarded schema reset from the repository root."""

import sys

from uk_budget_data.cli import main

if __name__ == "__main__":
    raise SystemExit(main(["reset", *sys.argv[1:]]))
