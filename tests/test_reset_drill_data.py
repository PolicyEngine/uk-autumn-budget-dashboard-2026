"""Schema reset preserves references and fails before any partial reset."""

import pytest

from uk_budget_data.cli import RESET_CSV_FILES, reset_drill_data


def fixture_directory(tmp_path):
    config = tmp_path / "policyConfig.js"
    config.write_text("export const POLICIES = [];\n")
    data = tmp_path / "data"
    data.mkdir()
    for name in RESET_CSV_FILES:
        (data / name).write_text("reform_id,year,value\nold,2026,123\n")
    (data / "reference.csv").write_text("code,name\n1,reference\n")
    (data / "map.geojson").write_text("{}")
    return data, config


def test_reset_is_allowlisted_idempotent_and_preserves_headers(tmp_path):
    data, config = fixture_directory(tmp_path)
    reset_drill_data(data, config, active_policy_ids=[])
    before = {p.name: p.read_bytes() for p in data.iterdir()}
    reset_drill_data(data, config, active_policy_ids=[])
    assert before == {p.name: p.read_bytes() for p in data.iterdir()}
    assert all(
        (data / n).read_text() == "reform_id,year,value\n"
        for n in RESET_CSV_FILES
    )
    assert (data / "reference.csv").read_text() == "code,name\n1,reference\n"
    assert (data / "map.geojson").read_text() == "{}"


def test_active_registries_block_reset_before_writing(tmp_path):
    data, config = fixture_directory(tmp_path)
    with pytest.raises(ValueError, match="backend"):
        reset_drill_data(data, config, active_policy_ids=["active"])
    config.write_text('export const POLICIES = [{ id: "active" }];')
    with pytest.raises(ValueError, match="frontend"):
        reset_drill_data(data, config, active_policy_ids=[])
    assert all(
        "old,2026,123" in (data / n).read_text() for n in RESET_CSV_FILES
    )


@pytest.mark.parametrize("invalid", ["missing", "header", "symlink"])
def test_invalid_file_blocks_every_write(tmp_path, invalid):
    data, config = fixture_directory(tmp_path)
    path = data / RESET_CSV_FILES[-1]
    path.unlink()
    if invalid == "header":
        path.write_text("\n")
    elif invalid == "symlink":
        private = tmp_path / "private.csv"
        private.write_text("reform_id,year,value\nprivate,2026,999\n")
        path.symlink_to(private)
    with pytest.raises(ValueError):
        reset_drill_data(data, config, active_policy_ids=[])
    assert "old,2026,123" in (data / RESET_CSV_FILES[0]).read_text()


def test_check_only_keeps_results(tmp_path):
    data, config = fixture_directory(tmp_path)
    reset_drill_data(data, config, active_policy_ids=[], check_only=True)
    assert "old,2026,123" in (data / RESET_CSV_FILES[0]).read_text()


def test_commented_empty_registry_does_not_bypass_active_guard(tmp_path):
    data, config = fixture_directory(tmp_path)
    config.write_text(
        '// export const POLICIES = [];\nexport const POLICIES = [{ id: "active" }];\n'
    )
    with pytest.raises(ValueError, match="frontend"):
        reset_drill_data(data, config, active_policy_ids=[])
