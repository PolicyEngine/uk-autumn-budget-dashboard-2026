"""Simulation modifiers for the candidate Autumn Budget 2026 measures, one
module per modifier.

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once, and
nothing that changes module state at run time (policyengine.py#571;
``docs/budget-day-publication.md``, "What the receipt asks of measure
code"). ``reforms.py`` fills caches at run time, so its modifiers cannot be
receipted; every modifier lives here instead, with its numbers as literal
default arguments, and ``reforms.py`` imports them.

The receipt binds the whole of a modifier's module: its source, and the
default arguments of every function in it. So each modifier has a module of
its own, named after it, and a fix to one changes only its own measure's
definition (until 25 October all seven shared one module, and any edit
there changed every one). A constant two modifiers use, the road fuel VAT
rate, is written in each of their modules; a helper modifiers share goes
outside the package, as the templates in ``measure_templates.py`` do.
``tests/test_budget_measures.py`` checks both, and
``tests/test_budget_measures_split.py`` the split.

Import a modifier from its module, as ``from
uk_budget_data.budget_measures.road_fuel_vat_cut import road_fuel_vat_cut``.
This package re-exports nothing: each module has its modifier's name, so a
package attribute of that name is the module.

Most modifiers are made only of the registered measure templates
(``measure_templates.TEMPLATES``), so ``template_proof.pure_templates``
proves them. They keep to the shape it proves: no docstring, only
assignments of template calls on parameters and literals, then a returned
template call. Others are hand-written, and need the two-person attestation
before an artifact of theirs can be approved: among them the employer
National Insurance relief for 21 to 24 year olds (no template changes
employer NI), the student loan connection (it deletes the survey's reported
repayments so the model's own are used), the Carer's Allowance earnings
taper (no template changes an entitlement test), the household energy
payment (no template pays by council tax band) and the £2 bus fare cap (no
template credits a share of a spending variable as income).

Fiscal years: year Y is Y-(Y+1). The road fuel VAT cut weights a part
year by its days from 1 April, the public finances' year; the electricity
zero rate weights 2026-27 by the October to March share of a year's use
and 2027-28 by the April to June share;
fuel duty is set as parameter values in ``reforms.py``, weighted from
6 April as the engine blends that parameter.
"""
