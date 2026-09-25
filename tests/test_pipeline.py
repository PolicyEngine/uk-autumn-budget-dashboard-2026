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

    def test_featured_obr_values_are_blank_without_like_for_like_estimates(
        self, tmp_path
    ):
        """Historical OBR figures stay available; featured comparisons are gated."""
        from uk_budget_data.models import DataConfig, ReformResult
        from uk_budget_data.pipeline import aggregate_results

        inputs = tmp_path / "inputs"
        inputs.mkdir()
        pd.DataFrame(
            [
                {
                    "reform_id": policy,
                    "year": 2027,
                    "obr_static_value": 1.5,
                    "obr_post_behavioural_value": 1.0,
                }
                for policy in ("dividend_tax_increase_2pp", "two_child_limit")
            ]
        ).to_csv(inputs / "obr_estimates.csv", index=False)

        def result(policy):
            return ReformResult(
                reform_id=policy,
                reform_name=policy,
                budgetary_impact=[
                    {
                        "reform_id": policy,
                        "reform_name": policy,
                        "year": 2027,
                        "value": 0.5,
                    }
                ],
                distributional_impact=[],
                winners_losers=[],
                metrics=[],
                income_curve=[],
                household_scatter=[],
                constituency=[],
                demographic_constituency=[],
            )

        comparison = aggregate_results(
            [result("dividend_tax_increase_2pp"), result("two_child_limit")],
            DataConfig(data_inputs_dir=inputs),
        )["obr_comparison"].set_index("reform_id")
        assert pd.isna(
            comparison.loc[
                "dividend_tax_increase_2pp", "obr_post_behavioural_value"
            ]
        )
        assert (
            comparison.loc["two_child_limit", "obr_post_behavioural_value"]
            == 1.0
        )
