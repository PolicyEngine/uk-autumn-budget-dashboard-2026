"""Whether the installed bundle routes results by area, for the page.

policyengine.py's release bundle says which release constituency and
local-authority regions load: its UK release manifest records the routing in
``regional_release_kind``, with a ``region_datasets`` path template for each
region type. A national-only release, certified with
``--drop-regional-release``, routes none, so no file of results by area
belongs to it.

The page needs to know that, to label its area views rather than show an
earlier release's results by area. This module writes
public/data/area-routing.json, the page's area routing status, from the
installed bundle. The page labels its area views "not available on this
release" when the file says so, and draws them only when it says
``available``: when it can't read the file, they say their results could not
be loaded and show no figures, since a file of results by area may belong to
an earlier release. The file holds two fields and changes only when the
routing does. tests/test_area_routing.py pins it to the installed bundle, so
a bundle adoption that changes the routing fails until the file is
regenerated::

    uv run python -m uk_budget_data.area_routing --write

``--check`` exits 1 when the file differs, and with neither option the
command prints the status. Run it from the repository root: the file's path
is relative to it.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from policyengine.provenance.manifest import get_release_manifest

AVAILABLE = "available"
NOT_AVAILABLE = "not_available"
# The region types the area views need. Certification routes the two
# together (LOCAL_AREA_REGION_TYPES in policyengine.provenance.certification).
AREA_REGION_TYPES = ("constituency", "local_authority")
# Every routing kind policyengine.py knows is decided here: the kinds the
# area run can serve, and the kinds it cannot (see area_views_status).
SERVED_KINDS = ("local_area", "area_coded_national")
UNSERVED_KINDS = ()
PATH = Path("public/data/area-routing.json")
COMMAND = "uv run python -m uk_budget_data.area_routing --write"


def area_views_status(manifest) -> str:
    """``available`` if the bundle routes the area views' data, else not.

    The page's area views show what the area run (``uk_budget_data.geography``)
    wrote from the release a bundle routes constituencies and local
    authorities to. Certification records the routing's kind:

    - ``local_area``: a local-area release (Microcosm's), whose households
      carry their constituency. The area run serves it as
      ``--dataset-kind microcosm``, from a copy of the routed file.
    - ``area_coded_national``: another release's national dataset (the
      enhanced FRS), carried with its constituency and local-authority
      weight matrices. The area run serves it as ``--dataset-kind efrs``
      with the seat weights, so it counts as available too.
    - none: nothing is routed. ``--drop-regional-release`` removes the
      routing, so the bundle names no release for constituencies or local
      authorities, and no file of results by area belongs to it. A template
      left over from the primary release's own metadata is not a routing,
      so it does not count.

    A kind in ``UNSERVED_KINDS``, or one from a later policyengine.py, reads
    as not available (tests/test_area_routing.py fails on a kind in neither
    list until the area run is checked against it). Both templates are
    needed too: certification routes the two region types together, so a
    manifest with only one is not a routing it wrote.

    Region results are not labelled: the area run publishes the region level
    only from an enhanced FRS run (``--dataset-kind efrs``), never from a
    local-area release, and that run does not read the routing.

    Args:
        manifest: The UK ``CountryReleaseManifest``, or anything with its
            ``regional_release_kind`` and ``region_datasets``.
    """
    routed = all(
        region_type in manifest.region_datasets
        for region_type in AREA_REGION_TYPES
    )
    if manifest.regional_release_kind in SERVED_KINDS and routed:
        return AVAILABLE
    return NOT_AVAILABLE


def area_routing(manifest) -> dict:
    """The file's fields for a UK release manifest."""
    return {
        "area_views": area_views_status(manifest),
        "regional_release_kind": manifest.regional_release_kind,
    }


def render(routing: dict) -> str:
    """The file's text: sorted keys, two-space indent, a final newline."""
    return json.dumps(routing, indent=2, sort_keys=True) + "\n"


def installed_routing() -> dict:
    """The fields for the installed bundle's UK release."""
    return area_routing(get_release_manifest("uk"))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.area_routing",
        description="Write or check the page's area routing status from the "
        "installed bundle.",
    )
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--write", action="store_true", help="Write the file")
    action.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if the file does not match the installed bundle",
    )
    parser.add_argument(
        "--path",
        type=Path,
        help=f"The file (default: {PATH})",
    )
    args = parser.parse_args(argv)
    path = PATH if args.path is None else args.path
    if (args.write or args.check) and not path.parent.is_dir():
        advice = (
            ": run this from the repository root, or pass --path"
            if args.path is None
            else ""
        )
        print(f"{path.parent} is not a directory{advice}", file=sys.stderr)
        return 1
    routing = installed_routing()
    text = render(routing)
    if args.write:
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"Wrote {path}: area views {routing['area_views']}")
        return 0
    if args.check:
        current = path.read_text(encoding="utf-8") if path.is_file() else None
        if current != text:
            command = (
                COMMAND if args.path is None else f"{COMMAND} --path {path}"
            )
            print(
                f"{path} does not match the installed bundle's area "
                f"routing (area views {routing['area_views']}). Regenerate "
                f"it: {command}",
                file=sys.stderr,
            )
            return 1
        print(f"{path} matches: area views {routing['area_views']}")
        return 0
    print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
