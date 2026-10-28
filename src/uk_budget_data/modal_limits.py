"""The national Modal run's names and guards (``generate --national``).

Kept apart from ``modal_generate``, which imports ``modal``, so the plan
(``--dry-run``) and the tests read them without it.
"""

from uk_budget_data.dataset_cache import ATTEMPTS as DOWNLOAD_ATTEMPTS

NATIONAL_APP_NAME = "uk-budget-2026-national"
# The Modal Volume holding the pinned Microcosm files by SHA-256
# (``dataset_cache``). Private to the workspace, like the area run's.
DATASET_VOLUME = "uk-budget-2026-dataset-cache"
# Where the Volume is mounted in the national app's containers.
DATASET_CACHE_MOUNT = "/dataset-cache"
# The cache's one container: a 1.5 GB download with retries, then a hash.
PRIME_CPU = 1.0
PRIME_MEMORY_MB = 4 * 1024
PRIME_TIMEOUT_S = 15 * 60
# A measure's or the package's container: as the artifacts' own (32 GB, 2
# CPUs), no retries. One measure was 293-354 s with its download on 26
# October and the combined run about 7 min; the rows add a minute or two.
# A container still running after 30 min has gone wrong: at most 16 x 0.5
# h x about $0.35 a container-hour is about $2.80.
CPU = 2.0
MEMORY_MB = 32 * 1024
MAX_CONTAINERS = 16
NATIONAL_TIMEOUT_S = 30 * 60
# An idle measure container waits this long for the package before it
# stops, so the package can start warm; the app stops them all when the
# command ends either way.
NATIONAL_SCALEDOWN_S = 120

__all__ = [
    "CPU",
    "DATASET_CACHE_MOUNT",
    "DATASET_VOLUME",
    "DOWNLOAD_ATTEMPTS",
    "MAX_CONTAINERS",
    "MEMORY_MB",
    "NATIONAL_APP_NAME",
    "NATIONAL_SCALEDOWN_S",
    "NATIONAL_TIMEOUT_S",
    "PRIME_CPU",
    "PRIME_MEMORY_MB",
    "PRIME_TIMEOUT_S",
]
