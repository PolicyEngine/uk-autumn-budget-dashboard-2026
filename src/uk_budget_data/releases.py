"""The releases the dashboard serves: this Budget, and past fiscal events.

``releases.json`` is the allow-list. Python reads it here and the page reads
it in ``src/utils/publication/releases.js``; nothing else is served. A
release's identity is its id, name and date. A manifest authorises figures
only for the release whose data root it sits in, and only when it names
that release's id and date.

The current release keeps ``public/data``, so every 2026 path is unchanged.
A historical release (a fiscal event replayed on today's model and data,
docs/historical-releases.md) has its own root,
``public/data/releases/<id>``. The root decides the release: a data root
inside a ``releases`` directory serves the registered historical release of
that name, and any other root serves the default release.
"""

import json
import re
from dataclasses import dataclass
from datetime import date
from importlib.resources import files
from pathlib import Path
from typing import Optional

SCHEMA = "uk-budget-dashboard/releases/v1"
REGISTRY_FILE = "releases.json"
# The directory under the default data root holding every historical
# release's root. No artifact path in any manifest may enter it.
RELEASES_DIR = "releases"
CURRENT = "current"
HISTORICAL = "historical"
ID = re.compile(r"uk-[a-z0-9]+(?:-[a-z0-9]+)*\Z")
EVENT = re.compile(r"[a-z0-9]+(?:_[a-z0-9]+)*\Z")


class ReleaseError(ValueError):
    """A release registry, id or data root that the dashboard does not serve."""


@dataclass(frozen=True)
class Release:
    id: str
    kind: str
    name: str
    date: str
    data_root: str
    event: Optional[str] = None

    @property
    def budget(self) -> dict[str, str]:
        """The identity a manifest and release index must carry."""
        return {"id": self.id, "date": self.date}

    @property
    def historical(self) -> bool:
        return self.kind == HISTORICAL


def parse_registry(document: dict) -> tuple[Release, dict[str, Release]]:
    """The default release and every release by id, or ReleaseError.

    Exactly one release is current, it is the default and it keeps the
    default data root; every other is historical, with the root
    ``releases/<id>`` and the scorecard event it replays.
    """
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        raise ReleaseError("the release registry has an unknown schema")
    releases: dict[str, Release] = {}
    for raw in document.get("releases") or []:
        if not isinstance(raw, dict):
            raise ReleaseError("a release is not an object")
        fields = {"id", "kind", "name", "date", "data_root"}
        allowed = fields | {"event"}
        if not fields <= set(raw) or not set(raw) <= allowed:
            raise ReleaseError(
                f"release {raw.get('id')!r} has the wrong fields"
            )
        release = Release(**raw)
        if not isinstance(release.id, str) or not ID.fullmatch(release.id):
            raise ReleaseError(f"release id {release.id!r} is not a valid id")
        if release.id in releases:
            raise ReleaseError(f"release {release.id} is listed twice")
        if not isinstance(release.name, str) or not release.name.strip():
            raise ReleaseError(f"release {release.id} has no name")
        try:
            if date.fromisoformat(release.date).isoformat() != release.date:
                raise ValueError
        except (TypeError, ValueError):
            raise ReleaseError(
                f"release {release.id}: {release.date!r} is not a date"
            )
        if release.kind == CURRENT:
            if release.data_root != "" or release.event is not None:
                raise ReleaseError(
                    f"the current release {release.id} keeps the default "
                    "data root and replays no event"
                )
        elif release.kind == HISTORICAL:
            if release.data_root != f"{RELEASES_DIR}/{release.id}":
                raise ReleaseError(
                    f"historical release {release.id} must live in "
                    f"{RELEASES_DIR}/{release.id}"
                )
            if not isinstance(release.event, str) or not EVENT.fullmatch(
                release.event
            ):
                raise ReleaseError(
                    f"historical release {release.id} names no replayed event"
                )
        else:
            raise ReleaseError(
                f"release {release.id} has kind {release.kind!r}"
            )
        releases[release.id] = release
    current = [r for r in releases.values() if r.kind == CURRENT]
    default = releases.get(document.get("default"))
    if len(current) != 1 or default is None or default.kind != CURRENT:
        raise ReleaseError(
            "the registry must list exactly one current release, as its default"
        )
    events = [r.event for r in releases.values() if r.historical]
    if len(events) != len(set(events)):
        raise ReleaseError("two historical releases replay the same event")
    return default, releases


def load_registry() -> tuple[Release, dict[str, Release]]:
    text = files("uk_budget_data").joinpath(REGISTRY_FILE).read_text()
    return parse_registry(json.loads(text))


DEFAULT_RELEASE, RELEASES = load_registry()


def get_release(release_id: str) -> Release:
    """The registered release with this id, or ReleaseError."""
    release = RELEASES.get(release_id) if isinstance(release_id, str) else None
    if release is None:
        raise ReleaseError(
            f"{release_id!r} is not a release the dashboard serves"
        )
    return release


def release_for_root(data_root: Path) -> Release:
    """The release a data root serves.

    A root directly inside a ``releases`` directory serves the registered
    historical release of that name; one that names no registered release
    is refused rather than read as the default. Any other root serves the
    default release.
    """
    path = Path(data_root)
    if path.parent.name != RELEASES_DIR:
        return DEFAULT_RELEASE
    release = RELEASES.get(path.name)
    if release is None or not release.historical:
        raise ReleaseError(
            f"{path} is inside {RELEASES_DIR}/ but is no registered "
            "historical release's data root"
        )
    return release


def data_root_for(release: Release, default_root: Path) -> Path:
    """A release's data root, given the default release's."""
    return (
        default_root / release.data_root if release.data_root else default_root
    )


def enters_releases_dir(relative: str) -> bool:
    """Whether a path relative to a data root enters the reserved directory.

    Each release's artifacts sit under its own root, so a manifest entry
    whose artifact path starts in ``releases/`` would read another
    release's files.
    """
    return Path(relative).parts[:1] == (RELEASES_DIR,)
