"""A helper module a measure imports, for tests/test_data_limits.py: the
detector must follow what a formula reads from it (review of #51 round
11). Not a test module, so pytest leaves its source as written."""


def surcharge(household, period, rate):
    return household("non_residential_property_purchased", period) * rate
