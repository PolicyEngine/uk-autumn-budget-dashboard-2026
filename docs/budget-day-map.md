# Budget day at a glance (28 October 2026)

A one-page map of the day for people: what happens, in what order, and who acts. The steps' detail is in the [checklist](budget-day-checklist.md) and the [runbook](budget-day-runbook.md), the agents' commands are in [`budget-day-agents.md`](budget-day-agents.md), and every signature is in [`budget-day-people.md`](budget-day-people.md). Times are UTC, which is UK time this week.

Shapes and colours in the maps:
- white rectangles with a teal border: agents' or automated steps;
- pale teal slanted boxes: runs on Modal;
- amber hexagons: a person signs, decides or merges.

## The day

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6B7280", "clusterBkg": "#F3F4F6", "clusterBorder": "#9CA3AF", "titleColor": "#1F2937", "primaryColor": "#FFFFFF", "primaryTextColor": "#1F2937", "primaryBorderColor": "#319795", "edgeLabelBackground": "#FFFFFF"}}}%%
flowchart TD
  subgraph TUE["Tuesday evening"]
    direction LR
    T1[/"18:00 regeneration of the seven candidates and their package"/] --> T2{{"Second signer attests Plan 2, the pensioner allowance, the package"}}
    T2 --> T3{{"Integrator redeploys the household calculator"}}
  end
  subgraph AM["Wednesday morning"]
    direction LR
    A1{{"07:00 go/no-go (Coordinator)"}} --> A2["11:30 start receipt: checks, versions, limits"]
  end
  subgraph SPEECH["From the speech, 12:30"]
    direction LR
    S1["Agents list and classify each measure"] --> S2["Agents encode the coded measures"]
    S2 --> S3{{"Expected-effects reviewer signs, then the Integrator merges the measures PR"}}
    S3 --> S4{{"Integrator redeploys the household API"}}
  end
  subgraph G2["13:15 provisional figures"]
    direction LR
    P1[/"Generate each measure on Modal"/] --> P2["Agents reconcile and stage as provisional"]
    P2 --> P3{{"Integrator signs review rows and merges"}}
  end
  subgraph G3["From 13:40: documents"]
    direction LR
    D1["Agents fetch the Red Book, costings and OBR files"] --> D2["Agents enter the Treasury costings"]
    D2 --> D3{{"Integrator checks the costings and approves"}}
    D1 --> D4{{"Integrator loads the OBR forecast"}}
  end
  subgraph G4["14:50: package and map"]
    direction LR
    M1[/"Combined run and area run on Modal"/] --> M2["Agents bind the map and write the files"]
    M2 --> M3{{"Integrator signs review rows and merges"}}
  end
  subgraph LATE["Afternoon and night"]
    direction LR
    L1{{"15:45 first cut to media, approved figures only"}} --> L2["PDF report and briefing by 07:00 Thursday"]
  end
  TUE --> AM --> SPEECH --> G2 --> G3 --> G4 --> LATE
  classDef agent fill:#FFFFFF,stroke:#319795,stroke-width:2px,color:#1F2937
  classDef modal fill:#EAF5F4,stroke:#0F766E,stroke-width:2px,color:#1F2937
  classDef person fill:#FDF0E1,stroke:#B45309,stroke-width:2px,color:#1F2937
  class A2,S1,S2,P2,D1,D2,M2,L2 agent
  class T1,P1,M1 modal
  class T2,T3,A1,S3,S4,P3,D3,D4,M3,L1 person
  style TUE fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style AM fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style SPEECH fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style G2 fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style G3 fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style G4 fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style LATE fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  linkStyle default stroke:#6B7280,stroke-width:2px
```

1. **Tuesday evening.**
   - At 17:30 calculation code freezes (#222).
   - At 18:00 the Coordinator regenerates the seven candidates and their package on Modal.
   - The second signer then attests the three hand-written receipts.
   - The household calculator is redeployed from the same commit before 08:00 (#231).
2. **Wednesday morning.**
   - The Coordinator holds the go/no-go at 07:00. After it, only an emergency revert changes the release.
   - By 11:30 the start receipt records the code, data, versions and limits (G0).
3. **The speech, 12:30.** Agents list every measure and sort it: parameter change, template, hand-written code, ledger only, or not computable.
   - They encode the coded ones in one measures PR.
   - The expected-effects reviewer signs each new measure's direction before it merges.
   - The Integrator merges the PR, then redeploys the household API so the calculator knows the new measures.
4. **Provisional figures, 13:15** (G2).
   - Each measure runs in its own Modal container: 6 to 16 min on 6.11.1 (#250).
   - Agents reconcile and stage the measures as provisional.
   - The Integrator signs the review rows and merges, and the page shows "statement figures, awaiting Treasury costing".
5. **Documents, from about 13:40** (G3).
   - Agents fetch the Red Book, the Treasury's policy costings and the OBR's outlook, recording each file's time and hash.
   - Agents enter the Treasury costings, and the Integrator checks them.
   - Agents reconcile each measure against the static costing, and the Integrator approves it.
   - The Integrator loads the OBR forecast.
   - Once those inputs are in, agents also write the official costings comparison and the OBR's effect on CPI.
6. **Package and map, from 14:50** (G4).
   - The combined run (about 7 min) and the area run (about 55–60 min with the Warm Home Discount top-up and Plan 2) start together on Modal.
   - Then agents bind the map, and the Integrator signs the review rows and merges. The map is live about 20–25 min after the area run ends (#250).
7. **Afternoon and night.**
   - The first cut goes to media at 15:45: approved figures from one manifest revision only, after a comparables review.
   - Overnight, the PDF report (#227, a draft) and the briefing are built from approved entries, by 07:00 on Thursday.
8. **Any time: a correction.** Withdraw the measure, fix it, redeploy the API, regenerate, attest again, and republish (G5). If the page itself breaks, roll back.

## How data reaches the dashboard

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6B7280", "clusterBkg": "#F3F4F6", "clusterBorder": "#9CA3AF", "titleColor": "#1F2937", "primaryColor": "#FFFFFF", "primaryTextColor": "#1F2937", "primaryBorderColor": "#319795", "edgeLabelBackground": "#FFFFFF"}}}%%
flowchart TD
  subgraph DATA["The data and the model"]
    direction LR
    B1["Build the Microcosm UK cut"] --> B2["Upload the national and local-area files to Hugging Face"]
    B2 --> B3{{"Certify the pair in a policyengine.py PR: UK hub runs the gates, Coordinator accepts, independent review approves"}}
    B3 --> B4["Merge and release policyengine.py"]
  end
  subgraph DASH["The dashboard"]
    direction LR
    B5["Bot opens the adoption PR"] --> B6["Regenerate the published files and update the limits on the branch"]
    B6 --> B7{{"Approve on the branch, then the Integrator merges"}}
    B7 --> B8{{"Redeploy the household API and check it"}}
  end
  DATA --> DASH
  classDef agent fill:#FFFFFF,stroke:#319795,stroke-width:2px,color:#1F2937
  classDef modal fill:#EAF5F4,stroke:#0F766E,stroke-width:2px,color:#1F2937
  classDef person fill:#FDF0E1,stroke:#B45309,stroke-width:2px,color:#1F2937
  class B1,B2,B4,B5,B6 agent
  class B3,B7,B8 person
  style DATA fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  style DASH fill:#F3F4F6,stroke:#9CA3AF,color:#1F2937
  linkStyle default stroke:#6B7280,stroke-width:2px
```

1. **Build.** The UK hub builds a Microcosm UK cut from the survey data: a national file, and a local-area file for constituencies.
2. **Upload.** Both go to the private Hugging Face repository `policyengine/populace-uk-private`, each under its own tag.
3. **Certify.** A policyengine.py pull request pins the cut to the policyengine-uk version it was built with. The UK hub runs the certification gates on its host, the Coordinator accepts the gates that need review, and an independent review of the evidence approves it. For 6.11.1 that was policyengine.py#720.
4. **Release.** Merging releases a new policyengine.py version to PyPI, with the model and data bound by one certificate. Certification and release took about 4.5 h for 6.10.0 (runbook, "Rolling re-cuts").
5. **Adopt.** The dashboard's bot opens a draft "Adopt policyengine X" pull request, as for #237. On its branch:
   - the limits the new pair lifts or adds are updated;
   - the published files (the outlook, the examples, the policy table) and every published measure are regenerated;
   - review rows are signed;
   - approvals are made before the merge.
6. **Merge and deploy.** The Integrator merges with a merge commit, and its revert PR is opened as a draft at once. The household API is redeployed (Cloud Run and Modal) and checked, and one breakdown is timed under 200 s.
7. **Budget day itself:** no adoption after the 07:00 go/no-go. Only an emergency revert to the previous release (runbook, "Rolling re-cuts").
