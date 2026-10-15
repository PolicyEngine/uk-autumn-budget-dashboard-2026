# VENDORED, do not edit. Source: PolicyEngine/policyengine.py main (the merge of PR #588)
# (carrying #571, #579, #588 and #628) at ebca9f0ca7639210e0482b5725c83a88645990d2,
# src/policyengine/provenance/loaded.py. Only the imports of sibling
# provenance modules are rewritten to this package. Delete this directory
# when the dashboard pins the policyengine release that contains this commit
# (after #571, #579, #588 and #628); uk_budget_data.publication.receipt prefers the released module.
"""The versions of packages as they were when this process loaded them.

Installing another version while a process runs changes what the
distribution metadata reports but not the code already imported, so a
receipt that read versions only from the metadata would name code that did
not run. policyengine records its own version when it is imported, and each
country model records its model, core and wrapper versions when it loads
the country package; receipts refuse a run whose installed versions differ.
"""

from __future__ import annotations

from collections.abc import Iterable
from importlib import metadata

_LOADED: dict[str, str] = {}


def record_loaded_versions(names: Iterable[str]) -> None:
    """Record each distribution's installed version, keeping the first seen."""

    for name in names:
        if name in _LOADED:
            continue
        try:
            _LOADED[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            continue


def loaded_versions() -> dict[str, str]:
    """The versions recorded when each distribution was loaded."""

    return dict(_LOADED)
