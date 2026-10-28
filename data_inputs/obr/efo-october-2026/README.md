# OBR: Economic and fiscal outlook, October 2026 (28 October 2026)

These are the Office for Budget Responsibility's files for the October 2026 Economic and fiscal outlook (EFO), kept unchanged so the team can read and check them. No dashboard calculation uses them. They do travel with the code: the household and generation Modal apps (`modal_household.py`, `modal_generate.py`) add all of `data_inputs/` to their containers at startup (Modal's `add_local_dir` without `copy=True`, so the files aren't built into the image), and the deploy's checkout check (`runtime_identity.py`) hashes the local files before upload. The living-standards app adds only its own subfolder. The Next.js site and the Docker image don't include them.

- **EFO page:** https://obr.uk/efo/economic-and-fiscal-outlook-october-2026/
- **Licence:** © Crown copyright 2026, published under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- **Text files:** each `.txt` is a text extraction of the PDF with the same name, made with `pdftotext -layout` (poppler 26.09.0) for searching. The PDF is the authority.
- **How they were fetched:** obr.uk sits behind a Cloudflare browser check, so its files were downloaded in a normal Chrome session (Claude in Chrome) on 28 Oct 2026. The EFO PDF itself came from GOV.UK with `curl`.

## The EFO

| File | Source | Bytes | SHA-256 | Server Last-Modified |
|---|---|--:|---|---|
| `economic-and-fiscal-outlook-october-2026-web-accessible.pdf` | [GOV.UK page](https://www.gov.uk/government/publications/october-2026-economic-and-fiscal-outlook) ([file](https://assets.publishing.service.gov.uk/media/6ae1f7b839d29f3f9b9b3f36/economic-and-fiscal-outlook-october-2026-web-accessible.pdf)), fetched 19:44Z. obr.uk's own EFO download link redirects to this same file | 1,754,344 | `9e0e9c340e35e603066f3124a614fcd68feadb3d5d10d1f76fb536e150e6225e` | 28 Oct 2026 13:25:12 GMT |

## Charts and tables (`charts-and-tables/`)

- The chapter files come from the OBR's charts-and-tables zip: https://obr.uk/docs/sodugn2q20l901oy19v1cz5e/efo-october-2026-charts-and-tables-zipfile.zip
  - 5,396,085 bytes; SHA-256 `926fc192ff897884e87ebe71ed6b88dad4931e0e060a89aedeeaf6a91f1c0912`.
  - Last-Modified 28 Oct 2026 14:06:00 GMT; downloaded 19:39Z.
  - The members are extracted unchanged. The chapter 2 member is byte-identical to the chapter 2 file the OBR also offers on its own (downloaded at 14:19Z).
- The devolved file was downloaded on its own at 19:41Z (Last-Modified 14:27:05 GMT).

| File | Bytes | SHA-256 |
|---|--:|---|
| `efo-october-2026-charts-and-tables-executive-summary.xlsx` | 677,544 | `fe6ad82d543a12bad2d900344a1b3f418bcfc1472a48f1938cef85c472601f16` |
| `efo-october-2026-charts-and-tables-chapter-2.xlsx` | 2,001,381 | `4f045932423cdddba9b2ba7132f0c7cb716dae8b0a0f2a982fba61788e4c6c80` |
| `efo-october-2026-charts-and-tables-chapter-3.xlsx` | 418,284 | `b8090e4fc3aa739f3f8cd709ff1cd5f347fd57c2ea7c5b3b2b56c04fe90aad62` |
| `efo-october-2026-charts-and-tables-chapter-4.xlsx` | 448,552 | `28602510c775c37fab79448a750e67790b778509e10c0d12be98b0d9ba6116da` |
| `efo-october-2026-charts-and-tables-chapter-5.xlsx` | 596,074 | `b89d8095978dad807dafa48e24e380afc0241ba47e58527189969b0bfe2eeae3` |
| `efo-october-2026-charts-and-tables-chapter-6.xlsx` | 576,688 | `cb1c521048efe1cfdf70bcc217ef789e13d221423252580c90376f99ff02036e` |
| `efo-october-2026-charts-and-tables-chapter-7.xlsx` | 1,032,805 | `da7fd7154a4396f65e5ebf10db42249930005520757ee4fbe5e85ca5dcde8f45` |
| `efo-october-2026-charts-and-tables-annex-tables.xlsx` | 110,652 | `03fea17494639cafd77d68007691a93d61683cf05ddd36c0a17560c4da8811f1` |
| `efo-october-2026-charts-and-tables-devolved-tax-and-spending.xlsx` | 385,213 | `6bbf60d57f4134775e21f0b88bfdfc54d3e79c5e148d14bc820c052db6039a28` |

## Detailed forecast tables (`detailed-forecast-tables/`)

- These come from the OBR's detailed-forecast-tables zip: https://obr.uk/docs/sodugn2q20l901oy19v1cz5e/efo-october-2026-detailed-forecast-tables-zipfile.zip
  - 1,195,196 bytes; SHA-256 `06ac908c69fce7d69dbfda4e16fc3b091a83bd8140ecd2f24990acd13d945fc2`.
  - Last-Modified 28 Oct 2026 14:05:59 GMT; downloaded 14:20Z. The members are extracted unchanged.
- The OBR also offers each table as its own file. Those files are the same sizes but newer (Last-Modified 14:25:08 GMT), and they haven't been compared byte for byte with these.
- `policy.xlsx` Table 1.1 breaks each Budget measure down by tax or spending line. For example, it shows the Scottish block grant lines inside the Table 6.1 totals.

| File | Bytes | SHA-256 |
|---|--:|---|
| `efo-october-2026-detailed-forecast-tables-economy.xlsx` | 518,472 | `96795d1747bb5a4978c7fb768689d5fd31f568e5223db8a94b1bd92ba7f6c118` |
| `efo-october-2026-detailed-forecast-tables-receipts.xlsx` | 214,092 | `d115705716d77b11c190385d41cb1924f30080c9331a8a386c04d4e65a368e95` |
| `efo-october-2026-detailed-forecast-tables-expenditure.xlsx` | 280,700 | `f379f1b88431405c279332519c4ada10b67c060bcc5370453028d98c1ac81167` |
| `efo-october-2026-detailed-forecast-tables-aggregates.xlsx` | 218,000 | `3ffa3f1e63667b2ae9fb9626dc1da881673227d43aeeb52f8c3db168a5c75d6b` |
| `efo-october-2026-detailed-forecast-tables-policy.xlsx` | 106,602 | `cdcc2a06b100241bf3010bd159a4e5d43daef2348a3850797b1e88a308fd45fd` |
| `efo-october-2026-detailed-forecast-tables-debt-interest.xlsx` (the debt interest ready reckoner) | 45,331 | `48771b5a0b84a736fd1f4b5274c2c4f2677a976a14f97f5a012f9792dcc171ad` |

## Other OBR publications from the same day

Each was downloaded from https://obr.uk/docs/sodugn2q20l901oy19v1cz5e/ followed by the file name.

| File | Bytes | SHA-256 | Server Last-Modified | Downloaded |
|---|--:|---|---|---|
| `efo-october-2026-devolved-tax-and-spending.pdf` (Devolved tax and spending forecasts) | 334,277 | `308c7ab7b559fea1be894eb5be2ce42af307f98ca68ee8dfa9e2407f893df343` | 14:27:05 GMT | 19:41Z |
| `efo-october-2026-speaking-notes.pdf` | 128,826 | `84a9ce2cc05501d1d44292c37e636f61c90f0d7637223246f81f27477d02cc4a` | 15:17:48 GMT | 19:45Z |
| `efo-october-2026-presentation-slides.pdf` | 189,839 | `564c90dac9823f0f9bf2f76086bf89669c1dcb0300bb9d088a5476bdbf077427` | 15:17:48 GMT | 19:45Z |
| `efo-october-2026-log-of-substantive-contact.pdf` (contact between the OBR and Treasury ministers, special advisers and private offices, 3 March to 27 October 2026) | 80,540 | `8625a607d6a5a8da5633baeb16cdd17f981456dccbfee0cfedfe80d91731a2ee` | 14:27:05 GMT | 19:45Z |

## Text extractions

Each `.txt` here is `pdftotext -layout` output (poppler 26.09.0) for the PDF of the same name, made on 28 Oct 2026 for searching. They aren't official files; the PDF is the authority. This README is provenance notes and isn't hashed.

| File | Extracted from | Bytes | SHA-256 |
|---|---|--:|---|
| `economic-and-fiscal-outlook-october-2026-web-accessible.txt` | `economic-and-fiscal-outlook-october-2026-web-accessible.pdf` | 727,958 | `0d449b8015fec840e66a5a9de03c06becb4546b59d8e6cd0b284da5194120ed4` |
| `efo-october-2026-devolved-tax-and-spending.txt` | `efo-october-2026-devolved-tax-and-spending.pdf` | 118,704 | `d68848d152fbb8b5eb40e063b17ebacef34bb405b9b23b066871bd47d9b9fd8b` |
| `efo-october-2026-log-of-substantive-contact.txt` | `efo-october-2026-log-of-substantive-contact.pdf` | 5,470 | `85b8a33dd277578be461bb746936123bf53dc1f0b5247fbaea48fb4ec1d74825` |
| `efo-october-2026-presentation-slides.txt` | `efo-october-2026-presentation-slides.pdf` | 12,187 | `37854029688714e87ee628dd3db4f2a0649f1b1590887dadd9b795d89cad65a6` |
| `efo-october-2026-speaking-notes.txt` | `efo-october-2026-speaking-notes.pdf` | 10,314 | `dd56727c451134dca7204e82492e08eaf47a774fab7b37279790c70ca6a66e31` |

## Not published yet

The October 2026 long-term economic determinants file wasn't on the EFO page at 14:22Z or at 19:39Z. The March 2026 version is dated 28 May 2026.

The November 2025 EFO is one folder up, in `../OBR-Economic-and-Fiscal-Outlook-November-2025.pdf`.
