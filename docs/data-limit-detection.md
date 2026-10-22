# Data-limit calculation audit

W5 checked both installed environments: policyengine 6.6.0 with core 3.33.0,
and policyengine 6.10.0 with core 3.33.3. Their relevant calculation code has
the same behaviour. `Simulation.calculate` calls `_calculate`, maps results
through `entity.key`, and optionally decodes enum results. `_calculate`
consults variable metadata before it runs a formula, including `defined_for`
(which can return a default without running that formula).

The fingerprint includes every Variable field that calculation and its
period-routing, formula-running, type-casting and default-array helpers read:
`name`, `entity`, `is_neutralized`, `requires_computation_after`,
`definition_period`, `quantity_type`, `defined_for`, `uprating`, `_uprating`,
`calculate_output`, `default_value`, `value_type`, `possible_values`, `dtype`,
`adds`, `subtracts`, `end`, and `formulas` (including every start date).
The entity fingerprint includes its `key` and `is_person`, which select
the population and control person/group mapping.
`Variable.get_formula` reads `formulas` and `end`: after `end` it returns no
formula. `Variable.default_array` reads `dtype`, `value_type`, `default_value`
and `possible_values`. The fingerprint also includes the callable attributes
`get_formula`, `default_array`, `check_defined_for_variable`,
`check_uprating_value_type`, and `set_input`, so replacing a method cannot
leave the variable apparently unchanged. `set_input` affects stored values
before calculation, and is included in addition to the calculation audit.
`Simulation.check_macro_cache`, called by calculation, also reads
`exhaustive_parameter_dependencies`. `Variable.check_uprating_value_type`
reads `baseline_variable` and `_explicit_attribute_names` when explaining
invalid uprating metadata; these are fingerprinted too. The calculation
methods and both Variable files were compared directly in both environments.
The differences in the Simulation files concern dataset loading, export
and subsampling, outside these calculation paths.
The `uprating` getter reads `_uprating`; both are compared.
The computation-mode helpers run from registration and the `uprating`
setter, rather than the calculation path. `Variable.is_input_variable`
runs during input export/rebuild, rather than calculation or macro caching.

Core's `Simulation._calculate` also reads
`parameters(period).gov.abolitions[variable.name]` before its holder cache or
formula. A difference in the abolition parameter's stored effective values
or cached views therefore makes that variable changed, even when none of
its own attributes changed. The existing observed-formula machinery then
decides which limits it touches.
For abolition views the comparison uses item access, matching core's
`gov.abolitions[variable.name]`. Their `_children` mapping can differ from
the attributes used for ordinary parameter reads, so reading only an
attribute would miss an effective cached abolition.
Ancestor caches are inspected even when the stored tree has no abolition
branch: a cached-only branch is still visible to core. Without such a
cached view, an absent branch stays absent and no full view is constructed.

Stored-input comparisons cover every input period and value in both storage
tiers, including branches, for each limit's missing input and its direct
formula readers. They read storage directly: a neutralised variable's default
or a calculated memory cache must not hide a supplied disk value.
Identical values moving between memory and disk, or repeated in both, count
as the same input. Conflicting values in the two tiers remain distinct in
core's read order, so a shadowed input is compared too.
Those readers are derived from the installed model's formula variable names
and parameter paths, together with both compared systems, rather than a
second list of SDLT, LBTT and LTT names. Derived calculation caches are
excluded. Presence matters: a supplied zero differs from no supplied input.
Receipt records use `input:<variable>`, accepted only for variables covered
by that same limit.

The static receipt validator can prove reader names only against the installed
model. A modifier adding a new reader and supplying it an input is detected,
but its custom `input:<name>` record is rejected until the installed model
can verify that reader. This keeps such an extension held rather than
accepting an unverified input name.
