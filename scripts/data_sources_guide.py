#!/usr/bin/env python3
"""
Data Sources Guide for Constituency Validation
===============================================

This module documents all external data sources used to validate the
UK Autumn Budget Dashboard constituency impact data.

Each data source includes:
- Description and purpose
- URL for download/access
- Data format and structure
- How to use it for validation
- Key fields and their meanings

Usage:
    # As a reference document:
    python scripts/data_sources_guide.py

    # Import in other scripts:
    from data_sources_guide import DataSources
    sources = DataSources()
    print(sources.get_all_sources())
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
import json


@dataclass
class DataSource:
    """Represents an external data source."""
    name: str
    organisation: str
    description: str
    url: str
    download_url: Optional[str]
    file_format: str
    update_frequency: str
    geography_level: str
    key_fields: List[str]
    how_to_use: str
    notes: str
    license: str


class DataSources:
    """Collection of all data sources used for validation."""

    def __init__(self):
        self.sources = self._define_sources()

    def _define_sources(self) -> Dict[str, DataSource]:
        """Define all data sources."""

        sources = {}

        # =============================================================
        # 1. END CHILD POVERTY - TWO-CHILD LIMIT DATA
        # =============================================================
        sources['end_child_poverty'] = DataSource(
            name="End Child Poverty - Two-Child Limit Data",
            organisation="End Child Poverty Coalition / Loughborough University",
            description="""
            Local child poverty statistics produced by Loughborough University for
            the End Child Poverty Coalition. Provides constituency-level estimates
            of children affected by the two-child limit and overall child poverty
            rates (after housing costs).

            This is the PRIMARY source for validating two-child limit constituency
            impacts as it directly measures the % of children affected by the policy.
            """,
            url="https://endchildpoverty.org.uk/child-poverty-2024/",
            download_url="https://endchildpoverty.org.uk/wp-content/uploads/2024/07/Two-child-limit-data-compared-to-child-poverty-1.xlsx",
            file_format="Excel (.xlsx)",
            update_frequency="Annual (usually June/July)",
            geography_level="Parliamentary Constituency (2024 boundaries)",
            key_fields=[
                "Region - UK region name",
                "Constituency - Parliamentary constituency name",
                "Percentage of children affected by two-child limit - % of children in families hit by 2CL",
                "Percentage of children living in poverty - Child poverty rate after housing costs (AHC)"
            ],
            how_to_use="""
            1. Download the Excel file from the download URL
            2. The file contains one sheet with all constituencies
            3. Column C = Two-child limit % (as decimal, multiply by 100)
            4. Column D = Child poverty % (as decimal, multiply by 100)

            Python example:
            ```python
            import pandas as pd
            df = pd.read_excel('Two-child-limit-data-compared-to-child-poverty-1.xlsx')
            df['two_child_pct'] = df['Percentage of children affected by two-child limit'] * 100
            df['poverty_pct'] = df['Percentage of children living  in poverty'] * 100
            ```

            For validation:
            - Correlate two_child_pct with project's relative_change
            - Expected correlation: r > 0.6 (strong positive)
            - Higher two-child % should mean higher gains from abolition
            """,
            notes="""
            - Uses DIFFERENT methodology to DWP/HMRC (not directly comparable)
            - Based on modelled estimates, not administrative data
            - After Housing Costs (AHC) measure - typically higher than BHC
            - Updated to 2024 constituency boundaries after General Election
            """,
            license="Open Government Licence"
        )

        # =============================================================
        # 2. DWP/HMRC - CHILDREN IN LOW INCOME FAMILIES
        # =============================================================
        sources['dwp_low_income'] = DataSource(
            name="Children in Low Income Families: Local Area Statistics",
            organisation="Department for Work and Pensions (DWP) / HMRC",
            description="""
            Official government statistics on children living in low income families.
            Published jointly by DWP and HMRC using administrative data from tax
            credits, Universal Credit, and other benefit systems.

            Provides BEFORE HOUSING COSTS (BHC) poverty measures at constituency level.
            This is the most authoritative source for low income family statistics.
            """,
            url="https://www.gov.uk/government/statistics/children-in-low-income-families-local-area-statistics-2014-to-2024",
            download_url="https://assets.publishing.service.gov.uk/media/67dc2c58c5528de3aa6711f9/children-in-low-income-families-local-area-statistics-2014-to-2024.ods",
            file_format="OpenDocument Spreadsheet (.ods)",
            update_frequency="Annual (usually March)",
            geography_level="Parliamentary Constituency, Local Authority, Ward",
            key_fields=[
                "Westminster Parliamentary Constituency - Constituency name",
                "Area Code - ONS constituency code (E14..., W07..., S14...)",
                "Number of children - Count of children in low income families",
                "Percentage of children - % of children in relative low income (BHC)"
            ],
            how_to_use="""
            1. Download the ODS file from GOV.UK
            2. Open sheet '5_Relative_ParlC' for constituency data
            3. Data starts at row 14 (after headers and notes)
            4. Columns 2-11 = Number of children (FYE 2015-2024)
            5. Columns 12-21 = Percentage of children (FYE 2015-2024)
            6. FYE 2024 data is in the last column of each section

            Python example:
            ```python
            import pandas as pd
            # pandas reads ODS files with python-calamine (engine="calamine")
            df = pd.read_excel('children-in-low-income-families.ods',
                              engine='calamine',
                              sheet_name='5_Relative_ParlC',
                              skiprows=13)
            # Or use the zipfile/xml approach for more control
            ```

            For validation:
            - Correlate FYE 2024 % with project's relative_change
            - Expected correlation: r > 0.6
            - Note: BHC rates are typically LOWER than AHC rates
            """,
            notes="""
            - BEFORE Housing Costs (BHC) measure
            - Based on 100% administrative data (not a sample)
            - Relative low income = below 60% of median income
            - Does NOT include Northern Ireland constituency data
            - Replaced older HMRC/DWP separate publications in 2020
            """,
            license="Open Government Licence v3.0"
        )

        # =============================================================
        # 3. HOUSE OF COMMONS LIBRARY - CONSTITUENCY DATA
        # =============================================================
        sources['commons_library'] = DataSource(
            name="House of Commons Library - Constituency Data: Child Poverty",
            organisation="House of Commons Library",
            description="""
            The Commons Library provides analysis and data for MPs. Their child
            poverty constituency dashboard combines DWP/HMRC data with additional
            context and is often cited in parliamentary debates.

            Useful for cross-referencing and for MP-facing communications.
            """,
            url="https://commonslibrary.parliament.uk/constituency-data-child-poverty/",
            download_url="https://commonslibrary.parliament.uk/constituency-data-child-poverty/",  # Excel link on page
            file_format="Excel (.xlsx) / Interactive Dashboard",
            update_frequency="Updated when DWP releases new data",
            geography_level="Parliamentary Constituency",
            key_fields=[
                "Constituency name",
                "Child poverty rate (relative, BHC)",
                "Child poverty rate (absolute, BHC)",
                "Number of children in poverty",
                "Regional comparisons"
            ],
            how_to_use="""
            1. Visit the Commons Library page
            2. Download the Excel file (link on page)
            3. Or use the interactive dashboard for quick lookups

            The data mirrors DWP statistics but with additional analysis.
            Useful for:
            - Verifying specific constituency figures
            - Finding regional context
            - MP briefing materials
            """,
            notes="""
            - Based on DWP/HMRC data (same underlying source)
            - Includes helpful context and comparisons
            - Good for MP-facing communications
            - Also available via Stat-Xplore for custom queries
            """,
            license="Open Parliament Licence"
        )

        # =============================================================
        # 4. STAT-XPLORE (DWP)
        # =============================================================
        sources['stat_xplore'] = DataSource(
            name="Stat-Xplore - Children in Low Income Families",
            organisation="Department for Work and Pensions (DWP)",
            description="""
            Stat-Xplore is DWP's online data exploration tool. It allows custom
            queries on benefit and poverty statistics with flexible breakdowns
            by geography, demographics, and time periods.

            Use this for custom analysis beyond the standard publications.
            """,
            url="https://stat-xplore.dwp.gov.uk/",
            download_url=None,  # Interactive tool
            file_format="Interactive / CSV export",
            update_frequency="Updated with each DWP release",
            geography_level="Constituency, Local Authority, Ward, LSOA",
            key_fields=[
                "Children in Low Income Families (Relative/Absolute)",
                "Breakdowns by: Age, Gender, Family Type, Work Status",
                "Time series from FYE 2015 onwards",
                "Geographic breakdowns to ward level"
            ],
            how_to_use="""
            1. Register for a free account at stat-xplore.dwp.gov.uk
            2. Navigate to: Children in Low Income Families
            3. Select measures: Relative Low Income / Absolute Low Income
            4. Add breakdowns: Geography > Westminster Parliamentary Constituency
            5. Select time period (FYE 2024 for latest)
            6. Export to CSV for analysis

            API access is also available for automated queries.
            """,
            notes="""
            - Requires free registration
            - More flexible than standard publications
            - Can get ward-level data for detailed analysis
            - API available for programmatic access
            """,
            license="Open Government Licence v3.0"
        )

        # =============================================================
        # 5. INSTITUTE FOR FISCAL STUDIES (IFS)
        # =============================================================
        sources['ifs'] = DataSource(
            name="IFS Analysis - Two-Child Limit",
            organisation="Institute for Fiscal Studies",
            description="""
            The IFS provides independent economic analysis of UK policy.
            Their work on the two-child limit includes cost estimates,
            poverty impact projections, and policy options analysis.

            Use for validating cost estimates and poverty reduction figures.
            """,
            url="https://ifs.org.uk/news/abolishing-two-child-limit-would-be-cost-effective-way-reducing-child-poverty-no-silver-bullet",
            download_url=None,  # Analysis reports, not raw data
            file_format="PDF reports / Web articles",
            update_frequency="Ad-hoc analysis",
            geography_level="National (UK-wide)",
            key_fields=[
                "Cost of abolition: ~£2.5bn/year",
                "Children lifted out of poverty: ~540,000",
                "Poverty reduction: ~4 percentage points (absolute)",
                "Cost per child lifted out: comparison with alternatives"
            ],
            how_to_use="""
            IFS provides analysis rather than raw data. Use for:

            1. Validating cost estimates:
               - Project estimate: £2.9-3.7bn/year
               - IFS estimate: £2.5bn/year
               - Difference due to take-up assumptions

            2. Validating poverty impact:
               - Project: ~0.8pp reduction in child poverty
               - IFS: ~4pp reduction in absolute poverty
               - Different measures, both valid

            3. Policy context for communications
            """,
            notes="""
            - Highly credible, independent source
            - Often cited in parliamentary debates
            - Methodologically rigorous
            - Good for validating order of magnitude
            """,
            license="IFS publications are copyrighted but quotable"
        )

        # =============================================================
        # 6. RESOLUTION FOUNDATION
        # =============================================================
        sources['resolution_foundation'] = DataSource(
            name="Resolution Foundation - Child Poverty Analysis",
            organisation="Resolution Foundation",
            description="""
            The Resolution Foundation is a think tank focused on living
            standards. Their 'Catastrophic caps' report and related work
            provides detailed analysis of the two-child limit and benefit cap.

            Excellent source for poverty projections and policy costs.
            """,
            url="https://www.resolutionfoundation.org/publications/catastophic-caps/",
            download_url=None,  # Reports, not raw data
            file_format="PDF reports / Data appendices",
            update_frequency="Ad-hoc analysis",
            geography_level="National / Regional",
            key_fields=[
                "Cost of abolition: £2.5bn (2024-25), rising to £3.6bn by 2035",
                "Children lifted from poverty: ~490,000 immediately",
                "Cost per child: ~£10,000 per child lifted out",
                "Interaction with benefit cap analysis"
            ],
            how_to_use="""
            Resolution Foundation provides detailed projections:

            1. Time-series cost projections:
               - 2024-25: £2.5bn
               - 2035 (full rollout): £3.6bn
               - Use to validate project's year-on-year estimates

            2. Regional analysis:
               - North West, West Midlands highest impact
               - Compare with project's regional patterns

            3. Combined reforms analysis:
               - Two-child limit + benefit cap interaction
               - 500,000 children from poverty at £4.5bn cost
            """,
            notes="""
            - Detailed methodology documentation
            - Often updates analysis with new data
            - Good for time-series validation
            - Includes behavioural responses
            """,
            license="Resolution Foundation publications are freely available"
        )

        # =============================================================
        # 7. CHILD POVERTY ACTION GROUP (CPAG)
        # =============================================================
        sources['cpag'] = DataSource(
            name="CPAG - Two-Child Limit Research",
            organisation="Child Poverty Action Group",
            description="""
            CPAG is the leading UK charity working on child poverty.
            They provide detailed research on the two-child limit's impact
            and campaign for its abolition.

            Good source for family-level impact data and case studies.
            """,
            url="https://cpag.org.uk/policy-and-research/our-position/two-child-limit-our-position",
            download_url=None,
            file_format="Web pages / PDF reports",
            update_frequency="Regular updates",
            geography_level="National / Case studies",
            key_fields=[
                "Families affected: 1.6 million children in 450,000 families",
                "Cost of abolition: £1.8-2bn",
                "Children lifted from poverty: 300,000-350,000",
                "Depth of poverty analysis"
            ],
            how_to_use="""
            CPAG provides context and case studies:

            1. Headline statistics:
               - 1.6m children affected
               - Compare with project's people_affected metric

            2. Policy briefings:
               - MP briefing materials
               - Useful for outreach communications

            3. Legal and policy context:
               - Exceptions to the two-child limit
               - Implementation details
            """,
            notes="""
            - Advocacy organisation (pro-abolition)
            - Good for understanding policy details
            - Case studies useful for communications
            - May have different cost estimates (different assumptions)
            """,
            license="CPAG materials available for non-commercial use"
        )

        # =============================================================
        # 8. OBR - OFFICE FOR BUDGET RESPONSIBILITY
        # =============================================================
        sources['obr'] = DataSource(
            name="OBR - Policy Costings",
            organisation="Office for Budget Responsibility",
            description="""
            The OBR provides independent fiscal forecasts and policy costings
            for the UK government. Their costings are the official estimates
            used in Budget documents.

            Essential for validating budgetary impact figures.
            """,
            url="https://obr.uk/",
            download_url=None,  # Embedded in Budget documents
            file_format="PDF (Budget documents) / Excel (supplementary tables)",
            update_frequency="At each Budget/Fiscal Event",
            geography_level="National",
            key_fields=[
                "Static costing - Direct fiscal impact",
                "Post-behavioural costing - Including behavioural responses",
                "Year-by-year projections (5 years)",
                "Uncertainty ranges"
            ],
            how_to_use="""
            OBR costings are in Budget documents:

            1. Find the relevant Budget document on obr.uk
            2. Look for 'Policy costings' or 'Policy decisions' table
            3. Find the specific measure (e.g., 'Two-child limit')
            4. Compare static and post-behavioural estimates

            For the project's OBR comparison:
            - Project data in: public/data/obr_comparison.csv
            - Already extracted from Budget 2024 documents
            """,
            notes="""
            - Official government estimates
            - Include behavioural responses
            - More conservative than academic estimates
            - May differ from project due to methodology
            """,
            license="Open Government Licence"
        )

        return sources

    def get_source(self, key: str) -> Optional[DataSource]:
        """Get a specific data source by key."""
        return self.sources.get(key)

    def get_all_sources(self) -> Dict[str, DataSource]:
        """Get all data sources."""
        return self.sources

    def print_source(self, key: str):
        """Print detailed information about a data source."""
        source = self.get_source(key)
        if not source:
            print(f"Source '{key}' not found.")
            return

        print("=" * 80)
        print(f"DATA SOURCE: {source.name}")
        print("=" * 80)
        print(f"\nOrganisation: {source.organisation}")
        print(f"\nDescription:{source.description}")
        print(f"\nURL: {source.url}")
        if source.download_url:
            print(f"Download URL: {source.download_url}")
        print(f"\nFile Format: {source.file_format}")
        print(f"Update Frequency: {source.update_frequency}")
        print(f"Geography Level: {source.geography_level}")
        print(f"\nKey Fields:")
        for field in source.key_fields:
            print(f"  - {field}")
        print(f"\nHow to Use:{source.how_to_use}")
        print(f"\nNotes:{source.notes}")
        print(f"\nLicense: {source.license}")

    def print_summary(self):
        """Print a summary table of all sources."""
        print("=" * 100)
        print("DATA SOURCES SUMMARY")
        print("=" * 100)
        print()
        print(f"{'Key':<25} {'Name':<40} {'Format':<15} {'Geography'}")
        print("-" * 100)
        for key, source in self.sources.items():
            print(f"{key:<25} {source.name[:38]:<40} {source.file_format[:13]:<15} {source.geography_level}")

    def export_to_json(self, filepath: str):
        """Export all sources to JSON file."""
        data = {}
        for key, source in self.sources.items():
            data[key] = {
                'name': source.name,
                'organisation': source.organisation,
                'description': source.description.strip(),
                'url': source.url,
                'download_url': source.download_url,
                'file_format': source.file_format,
                'update_frequency': source.update_frequency,
                'geography_level': source.geography_level,
                'key_fields': source.key_fields,
                'how_to_use': source.how_to_use.strip(),
                'notes': source.notes.strip(),
                'license': source.license
            }

        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"Exported to {filepath}")


def print_full_guide():
    """Print the complete data sources guide."""
    sources = DataSources()

    print("=" * 100)
    print("CONSTITUENCY DATA VALIDATION - DATA SOURCES GUIDE")
    print("=" * 100)
    print()
    print("This guide documents all external data sources used to validate")
    print("the UK Autumn Budget Dashboard constituency impact data.")
    print()
    print("=" * 100)
    print()

    # Print summary table
    sources.print_summary()
    print()

    # Print detailed info for each source
    for key in sources.sources.keys():
        print()
        sources.print_source(key)
        print()

    # Print quick reference
    print("=" * 100)
    print("QUICK REFERENCE - DOWNLOAD URLS")
    print("=" * 100)
    print()
    for key, source in sources.sources.items():
        if source.download_url:
            print(f"{source.name}:")
            print(f"  {source.download_url}")
            print()

    # Print validation workflow
    print("=" * 100)
    print("VALIDATION WORKFLOW")
    print("=" * 100)
    print("""
    1. PRIMARY VALIDATION (Constituency Level):
       - Download End Child Poverty data (two-child limit %)
       - Download DWP Children in Low Income Families data
       - Correlate with project's constituency.csv data
       - Expected: r > 0.6 correlation

    2. BUDGETARY VALIDATION (National Level):
       - Compare project budgetary_impact.csv with OBR costings
       - Check obr_comparison.csv for pre-extracted comparisons
       - Expected: Within 30% of OBR estimates

    3. POVERTY IMPACT VALIDATION:
       - Compare project metrics.csv poverty_change figures
       - Cross-reference with IFS/Resolution Foundation estimates
       - Expected: 0.5-1.0pp reduction in child poverty

    4. REGIONAL VALIDATION:
       - Check regional patterns match DWP regional data
       - West Midlands and North West should show highest impact
       - Scotland should show lower impact (Scottish Child Payment)

    Run the validation script:
        uv run python scripts/validate_constituency_data.py
    """)


if __name__ == "__main__":
    print_full_guide()

    # Also export to JSON
    sources = DataSources()
    sources.export_to_json("scripts/data_sources.json")
