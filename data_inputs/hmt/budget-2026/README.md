# HM Treasury: Budget 2026 documents (28 October 2026)

These are the official Budget 2026 files from GOV.UK, kept unchanged so the team can read and check them without downloading each one. No dashboard calculation uses them. They do travel with the code. Every Modal app that adds all of `data_inputs/` gets them in its containers at startup: the household, generation and constituencies apps (`modal_household.py`, `modal_generate.py`, `modal_constituencies.py`) and two dev scripts (`scripts/modal_household_bench.py`, `scripts/modal_verify_household_skips.py`). None passes `copy=True` to Modal's `add_local_dir`, so the files aren't built into any image. The living-standards app adds only its own subfolder. The deploy's checkout check (`runtime_identity.py`) hashes the local files before upload. The Next.js site and the Docker image don't include them.

- **Licence:** © Crown copyright 2026. All five PDFs carry a notice saying they are licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) "except where otherwise stated", and that any third-party copyright material they identify needs the holder's permission. The two workbooks carry no notice of their own.
- **Fetched:** with `curl` from GOV.UK on 28 Oct 2026, 19:44Z.
- **Text files:** each `.txt` is a text extraction of the PDF with the same name, made with `pdftotext -layout` (poppler 26.09.0) for searching. The PDF is the authority; the extraction can misplace table columns.

## Files

| File | GOV.UK page | Bytes | SHA-256 | Server Last-Modified |
|---|---|--:|---|---|
| `E03668986_HMT_Budget_2026_ELAY__2_.pdf` (Budget 2026, the main document) | [Budget 2026 document](https://www.gov.uk/government/publications/budget-2026-document) ([file](https://assets.publishing.service.gov.uk/media/6ae20b85460c1346f7be784e/E03668986_HMT_Budget_2026_ELAY__2_.pdf)) | 4,679,545 | `19b337aced8fe47de1d6ee462dabf75155110d347c38123b6380d90f09e97b93` | 28 Oct 2026 14:49:41 GMT |
| `E03668986_HMT_Budget_2026_TEXT_PRINT__1_.pdf` (Budget 2026, print version) | as above ([file](https://assets.publishing.service.gov.uk/media/6ae20b9039d29f3f9b9b3f55/E03668986_HMT_Budget_2026_TEXT_PRINT__1_.pdf)) | 1,875,646 | `e5d2e8763eae7e4fa8705a09d0dcf6db06ba6ef352af41edff4295d72a45d3df` | 28 Oct 2026 14:49:52 GMT |
| `Table_6.1_and_6.2_Budget_2026_Policy_Decisions.xlsx` | [Supporting documents for Budget 2026](https://www.gov.uk/government/publications/supporting-documents-for-budget-2026) ([file](https://assets.publishing.service.gov.uk/media/6ae187a2779378370fd80a9a/Table_6.1_and_6.2_Budget_2026_Policy_Decisions.xlsx)) | 67,126 | `359958df6b1ab9746073725f6f8017ebdbb55040e57cf28612891f1e294a7f15` | 28 Oct 2026 05:26:58 GMT |
| `Table_6.4_Recostings_Table.xlsx` (measures announced at Spring Statement 2026 or earlier) | as above ([file](https://assets.publishing.service.gov.uk/media/6ae0f93fe4367e5c8b0467d6/Table_6.4_Recostings_Table.xlsx)) | 76,402 | `b0449df1737f128fdc32ffeffbe7ed11876e7ab1c80d14dd9908e68a38386d3e` | 27 Oct 2026 19:19:27 GMT |
| `AB26_Policy_Costing.pdf` (Policy costings) | as above ([file](https://assets.publishing.service.gov.uk/media/6ae1883fe4367e5c8b0467df/AB26_Policy_Costing.pdf)) | 745,488 | `f716efada8a4d0726ce12b0f97d3f0dac671c31b2d005ecf300a48ff309638bf` | 28 Oct 2026 05:29:35 GMT |
| `Impact_on_households.pdf` (distributional analysis) | as above ([file](https://assets.publishing.service.gov.uk/media/6ae1850f16428df53760627d/Impact_on_households.pdf)) | 197,606 | `36cd5afb4fceca2cecba0d065974ffe8280888e15ed852c129339439e539469c` | 28 Oct 2026 05:15:59 GMT |
| `Budget_2026_-_Data_Sources.pdf` | as above ([file](https://assets.publishing.service.gov.uk/media/6ae1e9a2460c1346f7be77ff/Budget_2026_-_Data_Sources.pdf)) | 371,383 | `d3afd2b7ad3aa45dce035e69e0dd3abb9b03d9f568e092dcdc987097aa558f7e` | 28 Oct 2026 12:25:06 GMT |

## Text extractions

Each `.txt` here is `pdftotext -layout` output (poppler 26.09.0) for the PDF of the same name, made on 28 Oct 2026 for searching. They aren't official files; the PDF is the authority. This README is provenance notes and isn't hashed.

| File | Extracted from | Bytes | SHA-256 |
|---|---|--:|---|
| `AB26_Policy_Costing.txt` | `AB26_Policy_Costing.pdf` | 213,530 | `cbb16957b74baca074b7eab5b991bfc3ac390e170c7be65b7ad43c4fb26374fa` |
| `Budget_2026_-_Data_Sources.txt` | `Budget_2026_-_Data_Sources.pdf` | 51,270 | `53aabd239b9671370e706998aa6cd7bfbf38f7400d832d41f3ea3f55f652edc9` |
| `E03668986_HMT_Budget_2026_ELAY__2_.txt` | `E03668986_HMT_Budget_2026_ELAY__2_.pdf` | 488,933 | `5bded9fac772a53f7dbe9244bfc644ac867ad3377f3f10d92ea1b31f3eaae171` |
| `E03668986_HMT_Budget_2026_TEXT_PRINT__1_.txt` | `E03668986_HMT_Budget_2026_TEXT_PRINT__1_.pdf` | 619,374 | `9a755cc7f58ce83b99df784a17747075991c6c66390dc1f378a17e00d9565fe7` |
| `Impact_on_households.txt` | `Impact_on_households.pdf` | 28,173 | `d36dd2b550931d871ae23cab16c2efa166af78fb7288406c20db2f6887d96a93` |

## The Budget document was replaced after publication

GOV.UK replaced the main Budget PDF at 14:49Z, about 80 minutes after the 13:30Z publication. This folder has the replacement.

- An earlier copy (4,657,025 bytes, SHA-256 `bed70546c026487e3141799968f6df08210c182b0695fed0e8adf7efd6697e03`) has PDF ModDate 08:35:42 EDT; the replacement's is 10:46:49 EDT.
- The two texts differ in one place only: the heading of paragraph 6.207, which now reads "Benefit in Kind Appropriate Percentage Rates for 2030-31". The words "and potential for ULEV SalSac reforms" were removed.
- No other text changed. Charts weren't compared. Anyone who downloaded the Budget PDF before 14:49Z has the earlier copy.

## Not kept here

- **Budget 2026 (HTML):** https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html. It's a web page, not a file; the PDF has the same content.
- **Factsheets:** none has a downloadable file. On 28 Oct the [Budget 2026 factsheets collection](https://www.gov.uk/government/collections/budget-2026-factsheets) held 9 items (checked one by one through the GOV.UK content API): 3 news stories with no attachments, and 6 publications whose 7 attachments are all HTML pages, for example the [Pension Tax Allowance explainer](https://www.gov.uk/government/publications/pension-tax-allowance-explainer).
- **The 41 supplementary documents** in [Budget 2026 in full](https://www.gov.uk/government/collections/budget-2026-in-full): consultations, terms of reference and the like. Going by their titles, none is about a measure the dashboard models.
- **The OBR's Economic and fiscal outlook:** see `../../obr/efo-october-2026/`.
