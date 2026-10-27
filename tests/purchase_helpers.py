"""A helper module a measure imports, for tests/test_data_limits.py: the
detector must follow what a formula reads from it (review of #51 round
11). Not a test module, so pytest leaves its source as written. It also
holds the purchase constants the data-limit tests share."""

# A rate for the higher-rates band (residential additional dwellings,
# ``rate[1]``) that no installed model has as law, so setting it is a
# change on any: 5% in policyengine-uk 2.132.6, 7% from April 2025 in
# 2.147.2 (Finance Act 2025 s. 50).
RAISED_SURCHARGE = 0.09


def surcharge(household, period, rate):
    return household("non_residential_property_purchased", period) * rate
