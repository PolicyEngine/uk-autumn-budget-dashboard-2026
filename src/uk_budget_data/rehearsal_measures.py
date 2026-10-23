"""Modifiers for the 23 October rehearsal's mock measures (MOCK DATA).

A receipt binds a modifier only from a module of a fixed shape: imports,
literal constants and undecorated functions, each name bound once
(policyengine.py#571; tests/template_measures.py is the pattern). Keep this
module that shape. Parameter-only measures need nothing here: they are
built in rehearsal_registry.py from the templates' parameter changes.
"""
