"""The Forecast vintages tab's data: every OBR forecast beside the outturn.

``uk-budget-data forecast-vintages`` writes
``public/data/obr_forecast_vintages.json`` from the OBR's own files and ONS
outturn, with no PolicyEngine model figures:

- :mod:`.sources` pins every input: the OBR's Historical official forecasts
  database and each forecast's economy tables (Internet Archive captures,
  by SHA-256), the ONS series and the UK House Price Index;
- :mod:`.fetch` downloads the ONS series and House Price Index (and any
  missing OBR file, from its capture) into ``data_inputs/forecast_vintages``;
- :mod:`.hofd`, :mod:`.efo` and :mod:`.ons` read them;
- :mod:`.variables` says what the tab shows and where each comes from;
- :mod:`.periods` sets each forecast's launch period;
- :mod:`.build` checks the inputs and assembles the JSON.
"""
