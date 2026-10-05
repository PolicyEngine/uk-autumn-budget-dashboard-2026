# Dashboard data status

MOCK drill 2 pre-start state, 5 October 2026. Every generated CSV contains only its schema header; no previous drill or historical result rows remain. Geography outlines are static reference data, not policy results.

The selected national input is `microcosm_uk_2024_25.h5`, SHA-256 `aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af`, with UK 2.100.0/core 3.32.5. [Dataset provenance, accepted limitations and setup commands](../../docs/drill2-setup.md) define the run. Constituency outputs remain unavailable because this release has no aligned local weights or constituency codes.

Before release, run `uv run python scripts/validate_published_data.py --pre-start`. After registering the statement-derived measures and generating their results, run the full publication gate with an explicit `--policies` list. An empty-state pass is not numerical validation.
