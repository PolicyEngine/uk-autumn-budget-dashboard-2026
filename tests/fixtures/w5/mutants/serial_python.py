#!/usr/bin/env python3
"""Run the coordinator's pytest mutations serially in the chosen Python.

Set W5_MUTANT_PYTHON to the environment's Python and pass this executable
as mutants_files.py's <python>. The coordinator runner otherwise executes
unchanged; its -n 2 becomes -n 0 to avoid duplicate UK model imports.
"""

import os
import sys


def main():
    python = os.environ["W5_MUTANT_PYTHON"]
    arguments = sys.argv[1:]
    for index, argument in enumerate(arguments):
        if argument == "-n" and arguments[index + 1] == "2":
            arguments[index + 1] = "0"
        elif argument == "-n2":
            arguments[index] = "-n0"
    os.execv(python, [python, *arguments])


if __name__ == "__main__":
    main()
