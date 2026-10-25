"""Modelled student loan repayments in place of the survey's, on both sides
of ``plan_2_threshold_unfreeze``. Hand-written.

One modifier in a module of its own: see the package docstring.
"""


def connect_student_loan_repayments(sim):
    """Use policyengine-uk's modelled student loan repayments.

    In policyengine-uk 2.125.1 and later, ``gov_tax``, ``household_tax``
    and ``hbai_household_net_income`` count ``student_loan_repayments``,
    whose formula returns the modelled ``student_loan_repayment``. The
    dataset supplies its own ``student_loan_repayments`` values, which mask
    that formula, so they are deleted here.
    """
    variable = sim.tax_benefit_system.variables["student_loan_repayments"]
    if not variable.formulas:
        raise RuntimeError(
            "student_loan_repayments has no formula in this policyengine-uk "
            "version, so modelled repayments cannot replace the reported ones"
        )
    sim.delete_arrays("student_loan_repayments")
    return sim
