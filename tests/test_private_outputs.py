"""Tests for private outputs, which must never reach the repository."""

import stat

import pandas as pd
import pytest

from uk_budget_data.private_outputs import (
    AUDIT_DIR_ENV,
    PrivateOutputError,
    private_directory,
    save_private_csv,
)


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


class TestPrivateDirectory:
    def test_without_a_directory_it_refuses(self, monkeypatch):
        monkeypatch.delenv(AUDIT_DIR_ENV, raising=False)
        with pytest.raises(PrivateOutputError, match=AUDIT_DIR_ENV):
            private_directory()

    def test_it_reads_the_environment(self, monkeypatch, tmp_path):
        monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
        directory = private_directory(subdirectory="legacy")
        assert directory == (tmp_path / "audit" / "legacy").resolve()
        assert mode(directory) == 0o700

    def test_a_directory_inside_a_repository_is_refused(self, tmp_path):
        (tmp_path / "repo" / ".git").mkdir(parents=True)
        with pytest.raises(PrivateOutputError, match="git repository"):
            private_directory(tmp_path / "repo" / "outputs")
        assert not (tmp_path / "repo" / "outputs").exists()


class TestSavePrivateCsv:
    def test_only_the_owner_can_read_the_file(self, tmp_path):
        path = save_private_csv(pd.DataFrame({"a": [1]}), tmp_path / "x.csv")
        assert mode(path) == 0o600
        assert pd.read_csv(path)["a"].tolist() == [1]
