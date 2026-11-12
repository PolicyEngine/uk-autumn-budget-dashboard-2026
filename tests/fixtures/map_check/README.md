# Synthetic tables for the map check's tests

Every figure here is made up. The six seats (`T14000001` to `T14000006`, "Seat A" to "Seat F") and the three measures do not exist. `old/` and `new/` each stand in for a `public/data` folder: a table of results by constituency, a manifest, and each measure's national `winners_losers.csv`. `tests/test_map_check.py` reads them, with the expected counts and means worked out by hand from these rows.
