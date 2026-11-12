"""Export bounded synthetic test fixtures in the secret-free CI scope only."""

import argparse
import hashlib
import json
import os
import resource
import subprocess
import sys
import tarfile
import tempfile
import time
from importlib.metadata import version
from pathlib import Path

SOURCE_PATHS = (
    "src",
    "scripts",
    "tests",
    "data_inputs",
    "pyproject.toml",
    "uv.lock",
    ".python-version",
    ".github/workflows/ci.yml",
)
VERSIONS = {
    "policyengine": "6.16.2",
    "policyengine-uk": "2.165.1",
    "policyengine-core": "3.33.3",
}
KEYS = {
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "theta",
    "combined--alpha+beta",
}
MAX_OUTPUT_BYTES = 32 * 1024 * 1024


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def git(root, *args):
    return subprocess.check_output(
        ["/usr/bin/git", "-C", str(root), *args], text=True
    ).strip()


def source_files(root):
    names = git(root, "ls-files", "-z", "--", *SOURCE_PATHS).split("\0")
    if any((root / name).is_symlink() for name in filter(None, names)):
        raise RuntimeError("Selected source contains a symbolic link")
    return [
        {
            "path": name,
            "size": (root / name).stat().st_size,
            "sha256": digest(root / name),
        }
        for name in sorted(filter(None, names))
    ]


def cgroup_limits(unit):
    lines = Path("/proc/self/cgroup").read_text().splitlines()
    entries = [
        line.split(":", 2)[2] for line in lines if line.startswith("0::")
    ]
    if len(entries) != 1 or unit not in Path(entries[0]).parts:
        raise RuntimeError("Exporter is outside the required task scope")
    group = Path("/sys/fs/cgroup") / entries[0].lstrip("/")
    memory = int((group / "memory.max").read_text())
    swap = int((group / "memory.swap.max").read_text())
    quota, period = (group / "cpu.max").read_text().split()
    tasks = int((group / "pids.max").read_text())
    if (memory, swap, tasks) != (2147483648, 0, 64) or int(quota) != int(
        period
    ):
        raise RuntimeError(
            "Actual aggregate resource limits differ from the reviewed bounds"
        )
    # Require the measurement interface before any native command starts.
    int((group / "memory.peak").read_text())
    return group, {
        "memory_max_bytes": memory,
        "memory_swap_max_bytes": swap,
        "cpu_max": f"{quota} {period}",
        "tasks_max": tasks,
        "unit": unit,
        "runtime_max_seconds": 270,
        "stop_timeout_seconds": 5,
    }


def main():
    parser = argparse.ArgumentParser()
    for option in (
        "output",
        "runner-temp",
        "expected-head",
        "repository",
        "source-repository",
        "run-id",
        "run-attempt",
        "github-sha",
        "scope",
    ):
        parser.add_argument("--" + option, required=True)
    args = parser.parse_args()
    started = time.monotonic()
    root = Path(__file__).resolve().parents[1]
    output, temporary = (
        Path(args.output).resolve(),
        Path(args.runner_temp).resolve(),
    )
    if not output.is_relative_to(temporary) or output.is_relative_to(root):
        raise RuntimeError("Outputs must be outside source under RUNNER_TEMP")
    group, resources = cgroup_limits(args.scope)
    if os.geteuid() == 0:
        raise RuntimeError(
            "Exporter must run as the original unprivileged runner"
        )
    for name in (
        "HF_HUB_OFFLINE",
        "HF_DATASETS_OFFLINE",
        "PYTHONDONTWRITEBYTECODE",
    ):
        if os.environ.get(name) != "1":
            raise RuntimeError("Required offline/source protection is absent")
    if any(
        name in os.environ
        for name in (
            "HUGGING_FACE_TOKEN",
            "HF_TOKEN",
            "GITHUB_TOKEN",
            "ACTIONS_RUNTIME_TOKEN",
        )
    ):
        raise RuntimeError(
            "Credential environment must not enter synthetic generation"
        )
    head = git(root, "rev-parse", "HEAD")
    if (
        head != args.expected_head
        or len(head) != 40
        or git(root, "status", "--porcelain")
    ):
        raise RuntimeError("Checkout is not the exact clean requested source")
    remote = git(root, "config", "--get", "remote.origin.url")
    if (
        remote.removesuffix(".git")
        != "https://github.com/" + args.source_repository
    ):
        raise RuntimeError(
            "Checkout repository differs from the requested source"
        )
    before = source_files(root)
    installed = {name: version(name) for name in VERSIONS}
    if installed != VERSIONS:
        raise RuntimeError("Installed native package identities differ")
    output.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(root / "src") + os.pathsep + str(root)
    environment["GIT_SHA"] = head
    commands = []
    with tempfile.TemporaryDirectory(
        prefix="synthetic-fixtures-", dir=temporary
    ) as work:
        work = Path(work)
        publication = work / "publication"
        contract = work / "contract.json"
        command = [sys.executable, "-m", "uk_budget_data.publication.contract"]
        with contract.open("wb") as stream:
            subprocess.run(
                command, cwd=root, env=environment, stdout=stream, check=True
            )
        commands.append(command)
        command = [
            sys.executable,
            "scripts/make_publication_fixture.py",
            str(publication),
        ]
        subprocess.run(command, cwd=root, env=environment, check=True)
        commands.append(command)
        files, total = {}, 0
        for path in sorted(work.rglob("*")):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise RuntimeError("Output contains a non-regular entry")
            if path.is_file():
                name = path.relative_to(work).as_posix()
                if name != "contract.json" and not name.startswith(
                    "publication/"
                ):
                    raise RuntimeError("Unexpected output path")
                size = path.stat().st_size
                total += size
                if total > MAX_OUTPUT_BYTES or len(files) >= 4096:
                    raise RuntimeError(
                        "Synthetic output exceeds reviewed bounds"
                    )
                files[name] = {"size": size, "sha256": digest(path)}
        manifest = json.loads((publication / "manifest.json").read_text())
        if set(manifest["measures"]) | set(manifest["combined"]) != KEYS:
            raise RuntimeError("Unexpected synthetic fixture keys")
        archive = output / "synthetic-fixtures.tar.gz"
        with tarfile.open(archive, "w:gz") as target:
            for name in sorted(files):
                target.add(work / name, arcname=name, recursive=False)
    if git(root, "status", "--porcelain") or source_files(root) != before:
        raise RuntimeError("Tracked source changed during generation")
    source_manifest = output / "source-manifest.json"
    source_manifest.write_text(
        json.dumps({"commit": head, "files": before}, sort_keys=True) + "\n"
    )
    resources.update(
        memory_peak_bytes=int((group / "memory.peak").read_text()),
        cpu_stat=(group / "cpu.stat").read_text(),
        elapsed_seconds=time.monotonic() - started,
        parent_peak_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        child_peak_rss_kib=resource.getrusage(
            resource.RUSAGE_CHILDREN
        ).ru_maxrss,
    )
    metadata = {
        "backend": "github_actions",
        "github_actions": {
            "repository": args.repository,
            "run_id": int(args.run_id),
            "run_attempt": int(args.run_attempt),
            "head_sha": head,
        },
        "workflow": "CI",
        "job": "publication-fixtures",
        "job_name": "Publication fixtures",
        "source_repository": args.source_repository,
        "source_commit": head,
        "github_context_sha": args.github_sha,
        "source_clean_before": True,
        "source_clean_after": True,
        "source_files": before,
        "source_manifest_sha256": digest(source_manifest),
        "archive_sha256": digest(archive),
        "files": files,
        "versions": installed,
        "commands": commands,
        "resources": resources,
        "synthetic_only": True,
        "production_data_access": False,
        "test_code_revision": "a" * 40,
        "test_dataset": "World dummy bytes",
    }
    (output / "generation-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
