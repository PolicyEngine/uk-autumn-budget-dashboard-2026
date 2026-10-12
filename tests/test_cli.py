"""Tests for CLI module."""


class TestCLI:
    """Tests for CLI functionality."""

    def test_main_function_exists(self):
        """main function is importable."""
        from uk_budget_data.cli import main

        assert callable(main)

    def test_parse_args_generate_default(self):
        """parse_args returns defaults for generate subcommand."""
        from uk_budget_data.cli import parse_args

        args = parse_args(["generate"])
        assert args.command == "generate"
        assert args.output_dir is not None
        assert args.years is not None

    def test_parse_args_generate_custom_output(self):
        """parse_args accepts custom output directory for generate."""
        from uk_budget_data.cli import parse_args

        args = parse_args(["generate", "--output-dir", "/tmp/output"])
        assert str(args.output_dir) == "/tmp/output"

    def test_parse_args_generate_reforms(self):
        """parse_args accepts reform IDs for generate."""
        from uk_budget_data.cli import parse_args

        args = parse_args(
            ["generate", "--reforms", "two_child_limit", "fuel_duty_freeze"]
        )
        assert "two_child_limit" in args.reforms
        assert "fuel_duty_freeze" in args.reforms

    def test_parse_args_generate_years(self):
        """parse_args accepts years for generate."""
        from uk_budget_data.cli import parse_args

        args = parse_args(["generate", "--years", "2026", "2027"])
        assert args.years == [2026, 2027]

    def test_list_reforms_option(self):
        """parse_args accepts --list-reforms for generate."""
        from uk_budget_data.cli import parse_args

        args = parse_args(["generate", "--list-reforms"])
        assert args.list_reforms is True

    def test_parse_args_no_command(self):
        """parse_args with no command returns None command."""
        from uk_budget_data.cli import parse_args

        args = parse_args([])
        assert args.command is None

    def test_parse_args_lifetime(self):
        """parse_args accepts lifetime subcommand."""
        from uk_budget_data.cli import parse_args

        args = parse_args(["lifetime"])
        assert args.command == "lifetime"
        assert args.income == "p50"  # default

    def test_parse_args_lifetime_with_options(self):
        """parse_args accepts lifetime options."""
        from uk_budget_data.cli import parse_args

        args = parse_args(
            ["lifetime", "--income", "p75", "--student-loan", "60000"]
        )
        assert args.income == "p75"
        assert args.student_loan == 60000


class TestReformSelection:
    """Tests for reform selection logic."""

    def test_get_reforms_from_ids(self):
        """Can get reforms by their IDs."""
        from uk_budget_data.cli import get_reforms_from_ids

        reforms = get_reforms_from_ids(["two_child_limit", "fuel_duty_freeze"])
        assert len(reforms) == 2
        assert reforms[0].id == "two_child_limit"
        assert reforms[1].id == "fuel_duty_freeze"

    def test_get_reforms_from_ids_warns_unknown(self, capsys):
        """Warns about unknown reform IDs."""
        from uk_budget_data.cli import get_reforms_from_ids

        reforms = get_reforms_from_ids(
            ["two_child_limit", "unknown_reform_xyz"]
        )

        # Should only return the valid one
        assert len(reforms) == 1
        assert reforms[0].id == "two_child_limit"


def test_reset_cli_uses_explicit_directory_and_frontend_config(
    tmp_path, monkeypatch
):
    from uk_budget_data import cli

    data = tmp_path / "data"
    data.mkdir()
    for name in cli.RESET_CSV_FILES:
        (data / name).write_text("reform_id,year,value\nold,2026,1\n")
    config = tmp_path / "policyConfig.js"
    config.write_text("export const POLICIES = [];\n")
    monkeypatch.setattr(cli, "get_autumn_budget_2026_reforms", lambda: [])
    assert (
        cli.main(
            [
                "reset",
                "--output-dir",
                str(data),
                "--frontend-config",
                str(config),
            ]
        )
        == 0
    )
    assert (
        data / "budgetary_impact.csv"
    ).read_text() == "reform_id,year,value\n"
