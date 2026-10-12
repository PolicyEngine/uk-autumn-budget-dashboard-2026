Receipt v1 test fallback from policyengine.py PR #571, revision
`402900a`, copied from the supplied W4 snapshot. The pinned 6.2.6 wheel
does not yet contain these modules. Tests load these exact sources with
`importlib` only when the installed receipt module is absent. They need
pydantic and the installed `policyengine.utils.hashing` helper.

Source: https://github.com/PolicyEngine/policyengine.py/pull/571
