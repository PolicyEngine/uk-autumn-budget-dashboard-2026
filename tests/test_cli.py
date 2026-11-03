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
            [
                "generate",
                "--reforms",
                "household_energy_payment_2026",
                "fuel_duty_rise_deferral",
            ]
        )
        assert "household_energy_payment_2026" in args.reforms
        assert "fuel_duty_rise_deferral" in args.reforms

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


class TestReformSelection:
    """Tests for reform selection logic."""

    def test_get_reforms_from_ids(self):
        """Can get reforms by their IDs."""
        from uk_budget_data.cli import get_reforms_from_ids

        reforms = get_reforms_from_ids(
            ["household_energy_payment_2026", "fuel_duty_rise_deferral"]
        )
        assert len(reforms) == 2
        assert reforms[0].id == "household_energy_payment_2026"
        assert reforms[1].id == "fuel_duty_rise_deferral"

    def test_get_reforms_from_ids_warns_unknown(self, capsys):
        """Warns about unknown reform IDs."""
        from uk_budget_data.cli import get_reforms_from_ids

        reforms = get_reforms_from_ids(
            ["household_energy_payment_2026", "unknown_reform_xyz"]
        )

        # Should only return the valid one
        assert len(reforms) == 1
        assert reforms[0].id == "household_energy_payment_2026"


class TestLegacyGeographyFlag:
    """--legacy-geography needs a private directory before anything runs."""

    def test_without_a_private_directory_it_stops(self, monkeypatch):
        from uk_budget_data import cli
        from uk_budget_data.private_outputs import AUDIT_DIR_ENV

        monkeypatch.delenv(AUDIT_DIR_ENV, raising=False)

        def no_generation(**kwargs):
            raise AssertionError("data generation started")

        monkeypatch.setattr(cli, "generate_all_data", no_generation)
        parsed = cli.parse_args(["generate", "--legacy-geography"])
        assert cli.run_generate(parsed) == 1

    def test_it_passes_the_private_directory_on(self, monkeypatch, tmp_path):
        from uk_budget_data import cli
        from uk_budget_data.private_outputs import AUDIT_DIR_ENV

        monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path))
        seen = {}

        def capture(reforms, config, skip_input_check, **options):
            seen["dir"] = config.legacy_geography_dir
            raise FileNotFoundError("stop here")

        monkeypatch.setattr(cli, "generate_all_data", capture)
        parsed = cli.parse_args(["generate", "--legacy-geography"])
        assert cli.run_generate(parsed) == 1
        assert seen["dir"] == (tmp_path / "legacy").resolve()
