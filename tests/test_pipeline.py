"""Tests for the data generation pipeline."""

import pandas as pd
import pytest


class TestReformProcessor:
    """Tests for ReformProcessor class."""

    def test_processor_accepts_reform(self):
        """Processor can be created with a reform."""
        from uk_budget_data.models import Reform
        from uk_budget_data.pipeline import ReformProcessor

        reform = Reform(
            id="test",
            name="Test Reform",
            parameter_changes={"gov.test": {"2026": 100}},
        )

        processor = ReformProcessor(reform=reform)
        assert processor.reform.id == "test"

    def test_processor_accepts_data_config(self):
        """Processor can be created with custom data config."""
        from uk_budget_data.models import DataConfig, Reform
        from uk_budget_data.pipeline import ReformProcessor

        reform = Reform(id="test", name="Test")
        config = DataConfig(years=[2026, 2027])

        processor = ReformProcessor(reform=reform, config=config)
        assert processor.config.years == [2026, 2027]


class TestDataPipeline:
    """Tests for the main DataPipeline class."""

    def test_pipeline_can_be_created(self):
        """Pipeline can be instantiated."""
        from uk_budget_data.pipeline import DataPipeline

        pipeline = DataPipeline()
        assert pipeline is not None

    def test_pipeline_accepts_reforms(self):
        """Pipeline can be created with reforms."""
        from uk_budget_data.models import Reform
        from uk_budget_data.pipeline import DataPipeline

        reforms = [
            Reform(id="test1", name="Test 1"),
            Reform(id="test2", name="Test 2"),
        ]

        pipeline = DataPipeline(reforms=reforms)
        assert len(pipeline.reforms) == 2

    def test_pipeline_uses_default_reforms(self):
        """Pipeline uses Autumn Budget reforms by default."""
        from uk_budget_data.pipeline import DataPipeline

        pipeline = DataPipeline()
        assert len(pipeline.reforms) > 0


class TestCSVOutput:
    """Tests for CSV output functionality."""

    def test_save_csv_creates_directory(self, tmp_path):
        """save_csv creates parent directories if needed."""
        from uk_budget_data.pipeline import save_csv

        output_path = tmp_path / "subdir" / "output.csv"
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})

        save_csv(df, output_path)

        assert output_path.exists()
        loaded = pd.read_csv(output_path)
        assert len(loaded) == 2

    def test_save_csv_writes_correct_data(self, tmp_path):
        """save_csv writes DataFrame correctly."""
        from uk_budget_data.pipeline import save_csv

        output_path = tmp_path / "output.csv"
        df = pd.DataFrame(
            {
                "reform_id": ["test"],
                "year": [2026],
                "value": [1.5],
            }
        )

        save_csv(df, output_path)

        loaded = pd.read_csv(output_path)
        assert loaded.iloc[0]["reform_id"] == "test"
        assert loaded.iloc[0]["year"] == 2026
        assert loaded.iloc[0]["value"] == 1.5


class TestInputDataValidation:
    """Tests for input data validation."""

    def test_check_input_data_raises_for_missing_weights(self, tmp_path):
        """check_input_data raises if weights file missing."""
        from uk_budget_data.models import DataConfig
        from uk_budget_data.pipeline import check_input_data

        config = DataConfig(
            data_dir=tmp_path / "data",
            data_inputs_dir=tmp_path / "data_inputs",
        )

        # Create constituencies file but not weights
        (tmp_path / "data_inputs").mkdir()
        (tmp_path / "data_inputs" / "constituencies_2024.csv").write_text(
            "name,code\nTest,E14"
        )

        with pytest.raises(FileNotFoundError):
            check_input_data(config)


class TestGenerateAllData:
    """Tests for the main generate_all_data function."""

    def test_function_exists(self):
        """generate_all_data function is importable."""
        from uk_budget_data.pipeline import generate_all_data

        assert callable(generate_all_data)

    def test_function_accepts_reforms_list(self):
        """generate_all_data accepts a list of reforms."""
        from uk_budget_data.pipeline import generate_all_data

        # Just check it's callable with the right signature
        # Full integration test would require PolicyEngine data
        assert generate_all_data is not None


class TestResultAggregation:
    """Tests for aggregating results across reforms."""

    def test_aggregate_results_combines_dataframes(self):
        """aggregate_results combines multiple result sets."""
        from uk_budget_data.models import ReformResult
        from uk_budget_data.pipeline import aggregate_results

        results = [
            ReformResult(
                reform_id="test1",
                reform_name="Test 1",
                budgetary_impact=[{"year": 2026, "value": 1.0}],
                distributional_impact=[],
                winners_losers=[],
                metrics=[],
                income_curve=[],
                household_scatter=[],
                constituency=[],
                demographic_constituency=[],
            ),
            ReformResult(
                reform_id="test2",
                reform_name="Test 2",
                budgetary_impact=[{"year": 2026, "value": 2.0}],
                distributional_impact=[],
                winners_losers=[],
                metrics=[],
                income_curve=[],
                household_scatter=[],
                constituency=[],
                demographic_constituency=[],
            ),
        ]

        aggregated = aggregate_results(results)

        assert "budgetary_impact" in aggregated
        assert len(aggregated["budgetary_impact"]) == 2


class _Spy:
    """A calculator stand-in that records what it was given."""

    def __init__(self, result):
        self.calls = []
        self.result = result

    def calculate(self, *args, **kwargs):
        self.calls.append(args)
        return self.result


def _processor_with_spies(reform, config):
    from uk_budget_data.pipeline import ReformProcessor

    processor = ReformProcessor(reform=reform, config=config)
    processor.budgetary_calc = _Spy([])
    processor.distributional_calc = _Spy(([], pd.DataFrame()))
    processor.winners_losers_calc = _Spy([])
    processor.metrics_calc = _Spy([])
    processor.income_curve_calc = _Spy([])
    processor.household_scatter_calc = _Spy([])
    processor.age_calc = _Spy([])
    processor._calculate_constituency = lambda *args: ([], [])
    return processor


@pytest.mark.parametrize("own_baseline", [False, True])
def test_income_curve_uses_the_same_baseline_as_the_population(own_baseline):
    """Review finding: the curve got current law when the runs did not."""
    from uk_budget_data.models import DataConfig, Reform

    rate = "gov.hmrc.income_tax.rates.uk[0].rate"
    config = DataConfig(
        years=[2027], baseline_parameter_changes={rate: {"2027": 0.19}}
    )
    reform = Reform(
        id="m",
        name="M",
        parameter_changes={rate: {"2027": 0.21}},
        baseline_parameter_changes=(
            {rate: {"2027": 0.18}} if own_baseline else None
        ),
    )
    processor = _processor_with_spies(reform, config)
    processor.process(object(), object(), reform.baseline_scenario_for(config))
    baseline_scenario = processor.income_curve_calc.calls[0][0]
    expected = (
        reform.to_baseline_scenario()
        if own_baseline
        else config.get_baseline_scenario()
    )
    assert baseline_scenario is not None
    assert baseline_scenario.parameter_changes == expected.parameter_changes


class _StubCalculator:
    def __init__(self, result):
        self.result = result

    def calculate(self, *args, **kwargs):
        return self.result


def _stub_processor(config):
    """A processor whose calculators return nothing, with the legacy
    constituency step recorded instead of run."""
    from uk_budget_data.models import Reform
    from uk_budget_data.pipeline import ReformProcessor

    processor = ReformProcessor(Reform(id="test", name="Test"), config)
    processor.budgetary_calc = _StubCalculator([])
    processor.distributional_calc = _StubCalculator(([], None))
    processor.winners_losers_calc = _StubCalculator([])
    processor.metrics_calc = _StubCalculator([])
    processor.income_curve_calc = _StubCalculator([])
    processor.household_scatter_calc = _StubCalculator([])
    processor.age_calc = _StubCalculator([])
    calls = []

    def legacy(baseline, reformed, reform_id, year):
        calls.append(year)
        return [{"constituency_code": "X", "year": year}], []

    processor._calculate_constituency = legacy
    return processor, calls


class TestLegacyGeography:
    """The legacy constituency calculators have no disclosure control."""

    def test_they_run_only_on_request(self, tmp_path):
        from uk_budget_data.models import DataConfig

        processor, calls = _stub_processor(DataConfig(years=[2026, 2027]))
        result = processor.process(
            baseline=None, reformed=None, baseline_scenario=None
        )
        assert calls == []
        assert result.constituency == []

        processor, calls = _stub_processor(
            DataConfig(years=[2026, 2027], legacy_geography_dir=tmp_path)
        )
        result = processor.process(
            baseline=None, reformed=None, baseline_scenario=None
        )
        assert calls == [2026, 2027]
        assert len(result.constituency) == 2

    def test_their_rows_never_reach_the_output_directory(self, tmp_path):
        from uk_budget_data.models import DataConfig
        from uk_budget_data.pipeline import DataPipeline

        output_dir = tmp_path / "public"
        data = {
            "budgetary_impact": pd.DataFrame({"value": [1.0]}),
            "constituency": pd.DataFrame({"constituency_code": ["X"]}),
            "demographic_constituency": pd.DataFrame({"household_count": [1]}),
        }

        DataPipeline(config=DataConfig(output_dir=output_dir))._save_all(data)
        assert sorted(p.name for p in output_dir.iterdir()) == [
            "budgetary_impact.csv"
        ]

        private_dir = tmp_path / "private"
        config = DataConfig(
            output_dir=output_dir, legacy_geography_dir=private_dir
        )
        DataPipeline(config=config)._save_all(data)
        assert sorted(p.name for p in output_dir.iterdir()) == [
            "budgetary_impact.csv"
        ]
        assert sorted(p.name for p in private_dir.iterdir()) == [
            "legacy_constituency.csv",
            "legacy_demographic_constituency.csv",
        ]
        for path in private_dir.iterdir():
            assert path.stat().st_mode & 0o077 == 0

    def test_an_unsafe_directory_fails_before_any_simulation(
        self, tmp_path, monkeypatch
    ):
        from uk_budget_data import pipeline
        from uk_budget_data.models import DataConfig, Reform
        from uk_budget_data.private_outputs import PrivateOutputError

        def no_simulation(*args, **kwargs):
            raise AssertionError("a simulation was built")

        monkeypatch.setattr(pipeline, "build_microsimulation", no_simulation)
        (tmp_path / ".git").mkdir()
        config = DataConfig(legacy_geography_dir=tmp_path / "legacy")
        runner = pipeline.DataPipeline(
            reforms=[Reform(id="test", name="Test")], config=config
        )
        with pytest.raises(PrivateOutputError):
            runner.run()
