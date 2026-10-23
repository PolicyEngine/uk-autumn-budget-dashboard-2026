"""Machine-only reviewed-input stages for the certified-pair Budget rehearsal.

Never imports the engine, constructs a simulation, or writes outside .job.
The importer is a separate timed command: supply its untouched before tree and
scratch after tree. Human October input review and approval remain unmeasured.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata as metadata
import json
import math
from pathlib import Path
import time

JOB = Path(__file__).resolve().parent
SOURCE_ROOT = Path('/Users/maxghenis/reviews/uk-obr-receipts-importer-2341/sources')
FORECAST = Path('/Users/maxghenis/reviews/uk-hub/jobs/obr-rebase-dry-run/inputs/forecast.json')
HASHES = {
    'economy': 'fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510',
    'receipts': 'f65b6cb7f96931d4abd85940794eb60f6f65afca8bbf16c74a4548bf92766a28',
    'forecast': '6ae39003ef6897fa3cc591eb19eeefd45947df77de26eadcd2d602d6550284c3',
}
PINS = {'policyengine': '6.10.0', 'policyengine-uk': '2.132.6', 'policyengine-core': '3.33.3'}
PREFIX = 'gov.economic_assumptions.yoy_growth.'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def timelines(node, prefix=''):
    result = {}
    if not isinstance(node, dict):
        return result
    if 'values' in node:
        result[prefix] = {str(date): value for date, value in node['values'].items()}
    for key, child in node.items():
        if key not in {'values', 'metadata'} and isinstance(child, dict):
            result.update(timelines(child, f'{prefix}.{key}' if prefix else str(key)))
    return result


def number_at(node, date):
    values = node['values']
    key = max(str(key) for key in values if str(key) <= str(date))
    value = next(value for date, value in values.items() if str(date) == key)
    if isinstance(value, dict):
        value = value['value']
    return float(value)


def economic_tree(parameters):
    candidate = parameters / 'gov' / 'economic_assumptions'
    return candidate if candidate.is_dir() else parameters


def expected_changes():
    annual = {
        'obr.average_earnings': ([.053, .034, .024, .021, .022, .024], [.0531, .0336, .0236, .0209, .0221, .0241]),
        'obr.consumer_price_index': ([.034, .023, .020, .020, .020, .020], [.0337, .023, .0197, .0198, .0202, .020]),
        'obr.rpi': ([.041, .031, .030, .028, .029, .023], [.0413, .0308, .0298, .0278, .0288, .0226]),
        'obr.house_prices': ([.028, .024, .029, .027, .026, .024], [.0279, .0238, .0294, .0272, .0257, .0242]),
    }
    gaps = {
        'cpi_september': (9, [.00411, .00261, .00072, .00030, .00048, -.00020], [.00441, .00261, .00102, .00050, .00028, -.00020]),
        'awe_total_pay_may_july': (7, [.00259, .00274, .00027, -.00021, -.00015, -.00011], [.00249, .00314, .00067, -.00011, -.00025, -.00021]),
    }
    result = {}
    for series, (before, after) in annual.items():
        for year, left, right in zip(range(2025, 2031), before, after):
            if left != right:
                result[('yoy_growth.yaml', series, f'{year}-01-01')] = (left, right)
    for series, (month, before, after) in gaps.items():
        for year, left, right in zip(range(2025, 2031), before, after):
            if left != right:
                result[(f'statutory_uprating_inputs/forecast_gap/{series}.yaml', '', f'{year}-{month:02d}-01')] = (left, right)
    return result


def omitted_decisions():
    # This replays the already documented synthetic retention choices. It does
    # not impersonate October source review or claim a human has approved them.
    return [
        ('nominal_gdp_per_head', ['obr.per_capita.gdp'], 'synthetic override only', 'Retain rounded nominal-GDP-growth minus retained population convention; the supplied synthetic 2027 shock is -0.003.', 'March 2026'),
        ('other_per_capita_income', ['obr.per_capita.mixed_income', 'obr.per_capita.non_labour_income', 'obr.non_labour_income'], 'retain', 'E1.12 aggregate rows do not settle rounding/population conversion; no new transcription.', 'March 2026'),
        ('population', ['ons.population'], 'retain', 'Two supplied workbooks lack the required all-age source; no demographic recalibration.', 'March 2025 / ONS projection tail'),
        ('ahc_cpi', ['obr.consumer_price_index_ahc'], 'retain', 'Derived exclusion series; headline CPI is not a replacement.', 'March 2026'),
        ('social_and_private_rents', ['obr.social_rent', 'ons.private_rental_prices'], 'retain together', 'No live mapping approval: retain all 14 private-rent leaves and social cap; no isolated cap update.', 'Locked March projections / existing regional outturns'),
        ('council_tax', ['obr.council_tax'], 'retain', 'Country expenditure workbook rows are unavailable; UK receipts are not household-bill paths.', 'March 2026'),
        ('road_fuel', ['obr.road_fuel_volume', 'obr.petrol_spending_litre_proxy', 'obr.diesel_spending_litre_proxy'], 'retain', 'Duty receipts do not identify volumes or pump prices.', 'Locked physical-volume and price basis'),
        ('water_and_ni_rates', ['ofwat.water_bills', 'scottish_water.water_bills', 'finance_ni.domestic_rates'], 'retain', 'Separate regulator/local-rate sources; no EFO substitution.', 'Existing Ofwat / WICS / NI basis'),
        ('carbon_intensity', ['carbon_intensity'], 'retain', 'DESNZ intensity projection is outside the EFO.', 'Existing DESNZ basis'),
        ('corporate_sdlt_and_business_rates', [], 'retain', 'No corporate SDLT or four-nation business-rates split from these receipts workbooks; keep locked outturn statistics.', 'Locked HMRC and national outturn statistics'),
        ('bank_rate', [], 'retain for isolated shock', 'E1.9 annual-average mapping is a separately proposed update; not part of the exact supplied synthetic dictionary.', 'November 2025'),
        ('vat_coverage', [], 'retain', 'Retain survey coverage, household-share and legacy combined factors; forecast refresh does not recalibrate consumption.', 'Existing dataset calibration basis'),
        ('transport', [], 'retain', 'Keep observed fares, ridership, fitted distribution and fixed rail cost totals; bus cap edits are separate reform policy.', 'Existing DfT / ORR / Treasury vintages'),
        ('household_interest_proxy', ['ons.household_interest_income'], 'retain', 'Retain non-labour income proxy with income-series package.', 'Locked non-labour proxy basis'),
        ('private_rent_index_and_local_calibration', [], 'retain', 'Keep dated observed rent index and local calibration; a forecast overlay is not a data rebuild.', 'Existing monthly rent observations and calibration vintages'),
    ]


def run(before_parameters, after_parameters, runtime_parameters, output_dir):
    started = time.perf_counter()
    phase = started
    import yaml
    phases = {'yaml_import': time.perf_counter() - phase}
    output_dir = output_dir.resolve()
    require(output_dir.is_relative_to(JOB), 'All reviewed-input writes must stay under this workspace .job')
    output_dir.mkdir(parents=True, exist_ok=True)

    phase = time.perf_counter()
    pins = {name: metadata.version(name) for name in PINS}
    require(pins == PINS, f'Certified runtime pins differ: {pins}')
    source_paths = {'economy': SOURCE_ROOT / 'efo-march-2026-detailed-forecast-tables-economy.xlsx', 'receipts': SOURCE_ROOT / 'obr_efo_march_2026_receipts.xlsx', 'forecast': FORECAST}
    sources = {name: path.read_bytes() for name, path in source_paths.items()}
    for name, data in sources.items():
        require(sha(data) == HASHES[name], f'{name} hash differs')
    before = economic_tree(before_parameters.resolve())
    after = economic_tree(after_parameters.resolve())
    runtime = economic_tree(runtime_parameters.resolve())
    snapshots = {str(path): sha(path.read_bytes()) for path in sorted(before.rglob('*.yaml'))}
    snapshots.update({str(path): sha(path.read_bytes()) for path in sorted(runtime.rglob('*.yaml'))})
    require(snapshots, 'Parameter trees are empty')
    phases['source_pin_and_parameter_hashes'] = time.perf_counter() - phase

    phase = time.perf_counter()
    changes = {}
    text_changed_files = []
    require({str(path.relative_to(before)) for path in before.rglob('*.yaml')} == {str(path.relative_to(after)) for path in after.rglob('*.yaml')}, 'Importer changed YAML inventory')
    for path in sorted(before.rglob('*.yaml')):
        relative = str(path.relative_to(before))
        original = path.read_bytes()
        imported = (after / relative).read_bytes()
        if original != imported:
            text_changed_files.append(relative)
        old = timelines(yaml.safe_load(original))
        new = timelines(yaml.safe_load(imported))
        for series in old.keys() | new.keys():
            left, right = old.get(series, {}), new.get(series, {})
            for date in left.keys() | right.keys():
                if left.get(date) != right.get(date):
                    changes[(relative, series, date)] = (left.get(date), right.get(date))
    require(set(changes) == set(expected_changes()), f'Unexpected March numerical diff ({len(changes)} entries)')
    for key, expected in expected_changes().items():
        require(all(isinstance(value, (int, float)) and math.isclose(value, target, abs_tol=1e-12, rel_tol=0) for value, target in zip(changes[key], expected)), f'Unexpected value diff at {key}')
    annual = [pair for (path, _, _), pair in changes.items() if path == 'yoy_growth.yaml']
    require(len(changes) == 32 and len(annual) == 22, 'Wrong known March diff counts')
    require(all(round(left, 3) == round(right, 3) for left, right in annual), 'Annual changes exceed prior precision')
    old_growth = yaml.safe_load((before / 'yoy_growth.yaml').read_text())
    new_growth = yaml.safe_load((after / 'yoy_growth.yaml').read_text())
    gap_rows = []
    for gap, annual_name, month in [('cpi_september', 'consumer_price_index', 9), ('awe_total_pay_may_july', 'average_earnings', 7)]:
        relative = f'statutory_uprating_inputs/forecast_gap/{gap}.yaml'
        old_gap = yaml.safe_load((before / relative).read_text())
        new_gap = yaml.safe_load((after / relative).read_text())
        for year in range(2025, 2031):
            left = number_at(old_growth['obr'][annual_name], f'{year}-01-01') + number_at(old_gap, f'{year}-{month:02d}-01')
            right = number_at(new_growth['obr'][annual_name], f'{year}-01-01') + number_at(new_gap, f'{year}-{month:02d}-01')
            require(math.isclose(left, right, abs_tol=1e-12, rel_tol=0), f'Statutory source path changed at {gap} {year}')
            gap_rows.append({'series': gap, 'year': year, 'implied_before': left, 'implied_after': right})
    require(math.isclose(number_at(new_growth['obr']['mortgage_interest'], '2030-01-01'), .0553, abs_tol=1e-12), 'Retained blank-cell mortgage assumption changed')
    value_diff = [{'file': file, 'series': series, 'date': date, 'before': pair[0], 'after': pair[1]} for (file, series, date), pair in sorted(changes.items())]
    (output_dir / 'value-diff.json').write_text(json.dumps({'numerical_changes': value_diff, 'text_changed_files': text_changed_files, 'statutory_compensation_checks': gap_rows, 'retained_source_gap': {'sheet': '1.7', 'cell': 'H120', 'series': 'mortgage_interest', 'year': 2030, 'value': .0553}}, indent=2) + '\n')
    phases['value_diff_and_statutory_gap_validation'] = time.perf_counter() - phase

    phase = time.perf_counter()
    runtime_growth = yaml.safe_load((runtime / 'yoy_growth.yaml').read_text())
    ledger = []
    for family, paths, action, reason, vintage in omitted_decisions():
        values = {}
        absent = []
        for path in paths:
            node = runtime_growth
            try:
                for part in path.split('.'):
                    node = node[part]
            except KeyError:
                absent.append(PREFIX + path)
                continue
            for leaf, timeline in timelines(node).items():
                values[PREFIX + path + ('.' + leaf if leaf else '')] = timeline
        ledger.append({'family': family, 'synthetic_rehearsal_decision': action, 'reason': reason, 'retained_vintage': vintage, 'pinned_growth_timelines': values, 'paths_absent_from_certified_pin': absent})
    # Retain non-growth leaves as complete raw timelines, including historical
    # dates. These are not inserted into the six-path shock dictionary.
    non_growth_paths = [
        'gov.hmrc.stamp_duty.statistics.residential.corporate.revenue',
        'gov.hmrc.stamp_duty.statistics.non_residential.corporate.revenue',
        'gov.hmrc.business_rates.statistics.revenue',
        'gov.boe.base_rate',
        'gov.simulation.vat.survey_consumption_coverage',
        'gov.simulation.vat.household_share_of_receipts',
        'gov.simulation.microdata_vat_coverage',
        'gov.dft.rail.ridership_index', 'gov.dft.rail.fare_index',
        'gov.dft.rail.prior_law_fare_index', 'gov.dft.bus',
        'gov.indices.private_rent_index',
        'gov.economic_assumptions.local_authority_targets.ons_income',
    ]
    parameter_root = runtime_parameters.resolve()
    retained_non_growth = {}
    absent_non_growth = []
    for path in non_growth_paths:
        parts = path.split('.')
        node = None
        for count in range(1, len(parts) + 1):
            candidate = parameter_root.joinpath(*parts[:count]).with_suffix('.yaml')
            if not candidate.is_file():
                continue
            node = yaml.safe_load(candidate.read_text())
            for part in parts[count:]:
                if not isinstance(node, dict) or part not in node:
                    node = None
                    break
                node = node[part]
            break
        if node is None:
            directory = parameter_root.joinpath(*parts)
            if directory.is_dir():
                for candidate in sorted(directory.rglob('*.yaml')):
                    suffix = '.'.join(candidate.relative_to(directory).with_suffix('').parts)
                    for leaf, timeline in timelines(yaml.safe_load(candidate.read_text())).items():
                        retained_non_growth[path + '.' + suffix + ('.' + leaf if leaf else '')] = timeline
                continue
            absent_non_growth.append(path)
            continue
        for leaf, timeline in timelines(node).items():
            retained_non_growth[path + ('.' + leaf if leaf else '')] = timeline
    (output_dir / 'omitted-series-decisions.json').write_text(json.dumps({'scope': 'Replay of documented synthetic decisions; no new October human sign-off', 'human_review_seconds': None, 'decisions': ledger, 'retained_non_growth_timelines': retained_non_growth, 'paths_absent_from_certified_pin': absent_non_growth}, indent=2) + '\n')
    phases['omitted_series_retention_ledger'] = time.perf_counter() - phase

    phase = time.perf_counter()
    forecast = {}
    for path, shocks in {'consumer_price_index': {2026: .005, 2027: .005}, 'average_earnings': {2027: -.005}, 'house_prices': {2027: .02}, 'per_capita.gdp': {2027: -.003}}.items():
        node = runtime_growth['obr']
        for part in path.split('.'):
            node = node[part]
        forecast[PREFIX + 'obr.' + path] = {f'{year}-01-01.{year}-12-31': round(number_at(node, f'{year}-01-01') + shocks.get(year, 0), 8) for year in range(2026, 2032)}
    statutory_prefix = 'gov.economic_assumptions.statutory_uprating_inputs.'
    forecast[statutory_prefix + 'cpi_september'] = {'2026-01-01.2026-12-31': .035}
    forecast[statutory_prefix + 'awe_total_pay_may_july'] = {'2026-01-01.2026-12-31': .039}
    require(forecast == json.loads(sources['forecast']), 'Certified-pin reconstruction differs from exact supplied synthetic dictionary')
    encoded = (json.dumps(forecast, indent=2) + '\n').encode()
    require(sha(encoded) == HASHES['forecast'], 'Dated synthetic dictionary byte hash differs')
    forecast_path = output_dir / 'forecast.json'
    forecast_path.write_bytes(encoded)
    retained_gaps = {}
    synthetic_2027_proxies = {}
    for gap, annual_name, month in [('cpi_september', 'consumer_price_index', 9), ('awe_total_pay_may_july', 'average_earnings', 7)]:
        gap_node = yaml.safe_load((runtime / 'statutory_uprating_inputs' / 'forecast_gap' / f'{gap}.yaml').read_text())
        retained_gaps[gap] = {str(year): number_at(gap_node, f'{year}-{month:02d}-01') for year in range(2026, 2032)}
        synthetic_2027_proxies[gap] = forecast[PREFIX + 'obr.' + annual_name]['2027-01-01.2027-12-31'] + retained_gaps[gap]['2027']
    require(math.isclose(synthetic_2027_proxies['cpi_september'], .02572, rel_tol=0, abs_tol=1e-12), 'Certified CPI gap differs from reviewed synthetic expected path')
    require(math.isclose(synthetic_2027_proxies['awe_total_pay_may_july'], .01927, rel_tol=0, abs_tol=1e-12), 'Certified AWE gap differs from reviewed synthetic expected path')
    stat = {'scope': 'Published observations replayed from part 1; the annual synthetic shock is not added to observations', 'cpi_september_2026': .035, 'awe_total_pay_may_july_2026': .039, 'retained_certified_forecast_gaps': retained_gaps, 'synthetic_2027_proxies': synthetic_2027_proxies, 'april_2027_triple_lock_expected': max(.035, .039, .025), 'april_2028_triple_lock_expected': .026, 'human_review_seconds': None, 'forecast_gap_decision': 'Retain certified-pin gap files in exact isolated synthetic dictionary; importer compensation changes were reviewed separately', 'generated_indices_hand_edited': False}
    (output_dir / 'statutory-decisions.json').write_text(json.dumps(stat, indent=2) + '\n')
    phases['statutory_decisions_and_dated_dictionary'] = time.perf_counter() - phase

    phase = time.perf_counter()
    require(all(sha(Path(path).read_bytes()) == digest for path, digest in snapshots.items()), 'Read-only parameter source mutated')
    require(all(sha(path.read_bytes()) == HASHES[name] for name, path in source_paths.items()), 'Input source mutated')
    phases['source_immutability_verification'] = time.perf_counter() - phase
    result = {'scope': 'Machine replay of March value diff, documented omitted/statutory retention decisions, and exact part 1 synthetic dictionary; importer external time is separate; October acquisition and human review remain unmeasured', 'pins': pins, 'source_sha256': HASHES, 'forecast_path': str(forecast_path), 'forecast_sha256': sha(encoded), 'numerical_changes': len(changes), 'annual_precision_changes': len(annual), 'compensating_gap_changes': len(changes) - len(annual), 'maximum_annual_change_fraction': max(abs(right-left) for left, right in annual), 'omitted_series_families': len(ledger), 'forecast_paths': len(forecast), 'forecast_assignments': sum(map(len, forecast.values())), 'phases_seconds': phases, 'seconds': time.perf_counter() - started, 'machine_only': True, 'human_review_seconds': None}
    (output_dir / 'input-readiness.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before-parameters', type=Path, required=True, help='Untouched importer-version parameter tree')
    parser.add_argument('--after-parameters', type=Path, required=True, help='Scratch parameter tree after local importer')
    parser.add_argument('--runtime-parameters', type=Path, default=None, help='Certified UK 2.132.6 parameters, read only')
    parser.add_argument('--output-dir', type=Path, default=JOB / 'scratch' / 'reviewed-inputs')
    args = parser.parse_args()
    if args.runtime_parameters is None:
        args.runtime_parameters = Path(metadata.distribution('policyengine-uk').locate_file('policyengine_uk/parameters'))
    print(json.dumps(run(args.before_parameters, args.after_parameters, args.runtime_parameters, args.output_dir), indent=2), flush=True)


if __name__ == '__main__':
    main()
