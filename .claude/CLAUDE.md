# UK Autumn Budget 2026 dashboard: style and architecture guide

When working on the UK Autumn Budget 2026 dashboard, follow these guidelines. What the dashboard shows, its architecture, local development, data generation, review and deployment are in the [README](../README.md); this file does not repeat them.

## Critical: Dependency Management

### uv.lock Controls Installed Versions
**IMPORTANT**: The `uv.lock` file pins exact dependency versions. Manual `uv pip install` commands will be overridden by the lockfile on next `uv sync`.

When upgrading a dependency:
```bash
# CORRECT: Upgrade via lockfile
uv lock --upgrade-package <package>
uv sync

# WRONG: This will be overridden by uv.lock
uv pip install <package>==X.Y.Z
```

For the model and data, the package is `policyengine`, never `policyengine-uk` (below).

### Verifying Installed Package Contents
When checking if a package has specific changes:
1. First update the lockfile: `uv lock --upgrade-package <package>`
2. Sync: `uv sync`
3. Then check the installed files

### policyengine.py controls the model and data versions
This project depends on `policyengine[uk]` (policyengine.py), not on
`policyengine-uk` directly. policyengine.py pins an exact `policyengine-uk`
version **and** the certified dataset that goes with it, so the two can never
drift apart. Do not add `policyengine-uk` as a direct dependency or upgrade it
on its own — upgrade the bundle:

```bash
uv lock --upgrade-package policyengine
uv sync
```

Microsimulations are built through `pe.uk.managed_microsimulation()`, which
resolves the bundle's dataset from the private HuggingFace repo. That needs
`HUGGING_FACE_TOKEN` in the environment (and as a repo secret in CI).

The reforms in `src/uk_budget_data/reforms.py` are candidate Autumn Budget 2026 measures compared against current law (policyengine-uk before the Budget): each changes parameters, or applies a module-level modifier from its own module in `budget_measures/`, to show its impact.

## Visual Style Guide

### Colour palette
- Colours are tokens, not hex in components: the `--c-*` tokens in `src/app/globals.css` (on top of `@policyengine/ui-kit/theme.css`) give each colour a meaning (gain, loss, before, after, OBR, grid and so on).
- Charts take the same colours from `src/utils/chartTheme.js`, the JS mirror of those tokens (SVG and PNG exports need literal values); `chartTheme.test.js` keeps the two equal.
- Each measure's colour is in `src/utils/policyConfig.js`.

### Typography
- **Heading case**: Sentence case everywhere (e.g., "Budgetary impact", not "Budgetary Impact")
- **Number formatting**:
  - Currency: `£X.XXbn` for billions
  - Thousands: `X.Xk` format
  - Percentages: `XX.XX%` with 2 decimal places
  - Percentage points: `X.XXpp`
- **Locale**: British English (`en-GB`) for all formatting

### Spacing & Layout
- Section spacing: 24px between major sections, 48px for chart sections
- Card padding: Consistent use of spacing
- Margin conventions: 16px for standard spacing, 20px for chart margins

### Animations
- **Number animations**:
  - Duration: 800ms
  - Easing: Ease-out cubic for smooth deceleration
  - Use `requestAnimationFrame` for performance
- **Transitions**: Clean, professional - not sensationalized
- **Loading states**: Delay loading indicator by 300ms to avoid flash

## Component Architecture

### Tech stack
The stack is in the README's "Architecture" section. For components: React 19 hooks for state, Recharts 2 for charts, Tailwind CSS 4 and `@policyengine/ui-kit` (theme and page shell) plus component CSS.

### Key components
- `src/App.jsx`: the main controller. Holds the open tab (`VIEWS`), the selected measures and the year; fetches the precomputed CSVs from `public/data/`; keeps tab, sub-tab, measures and Personal impact answers in the address.
- `src/components/PopulationImpactView.jsx`: Population impact and its sub-tabs (All households, Young people).
- `src/components/PersonalImpactTab.jsx`: the household calculator; requests go through `src/utils/householdImpactApi.js`.
- `src/components/livingStandards/`: the Living standards tab.
- `src/components/MethodologyTab.jsx`: Methodology.
- `src/components/SubTabs.jsx` and `ViewTabs.jsx`: tab and sub-tab bars (`?sub=`).

### React Patterns
- **Hooks**: Use useState, useEffect, useRef, useMemo, useCallback
- **Component composition**: Break down into focused, reusable components
- **Custom hooks**: Create when logic is reused (e.g., data fetching)
- **Event handling**: Use CustomEvent for cross-component communication
- **Refs**: Use for DOM manipulation and animation (not for data)

### State Management Principles
- Lift state up to common ancestor (App.jsx)
- Pass data down as props
- Pass callbacks up for state changes
- Avoid prop drilling (but don't over-complicate with context for small apps)
- Keep derived state in useMemo/useCallback

## Chart & Visualization Guide

### Recharts Configuration
```jsx
<ResponsiveContainer width="100%" height={350}>
  <BarChart
    data={chartData}
    margin={{ top: 20, right: 30, left: 90, bottom: 20 }}
  >
    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
    <XAxis dataKey="year" />
    <YAxis
      label={{
        value: 'Label text',
        angle: -90,
        position: 'insideLeft',
        dx: -30,
        style: { textAnchor: 'middle' }
      }}
      tickFormatter={(value) => `formatted value`}
    />
    <Tooltip
      formatter={(value) => `formatted value`}
      labelFormatter={(label) => `Year: ${label}`}
    />
    <Legend wrapperStyle={{ paddingTop: '20px' }} />
    <Bar dataKey="metric" fill="#319795" name="Display Name" />
  </BarChart>
</ResponsiveContainer>
```

### Chart Best Practices
- Grid, ticks, margins and legend layout: take them from `src/utils/chartTheme.js`, not literals (the example above shows the shape only)
- Tooltips: Always include units and context
- Legend: Positioned below chart with 20px padding
- Responsive: Always wrap in ResponsiveContainer
- Data transformation: Convert to appropriate units (billions, thousands, percentages)

### Chart Types
- Bar charts: Primary visualization for time-series comparisons
- Multiple series: Use consistent color array for policies
- Grouped bars: Show policy comparisons side-by-side
- Toggle views: Offer different perspectives (reduction vs absolute, different years)

## Data Handling

### Data files
- The page reads files under `public/data/` written by `uk-budget-data` (for example `budgetary_impact.csv`, `distributional_impact.csv`, `winners_losers.csv`, `metrics.csv`, `regional.csv`, `income_curve.csv`, `living_standards_outlook.json`). Fetch them under the base path: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/<file>`.
- Every file under `public/` is a publication and needs a review row; see "Review and sign-off" in the README.
- The Living standards file's shape is in `docs/DATA_CONTRACT.md`.

## URL State Management
- Sync state to URL: Update query params when policies/params change
- Read from URL: Initialize state from URL on page load
- Use URLSearchParams: Clean API for query string manipulation
- History API: Use replaceState not pushState to avoid polluting history

## Content Style

### Language
- Dialect: British English (colour, analysing, organisation)
- Tone: Professional, policy-focused, objective
- Voice: Active voice, concise prose
- Audience: Policy researchers, government officials, informed public

### Writing Guidelines
- Introductions: Provide context for each chart section
- Descriptions: Explain what the chart shows and why it matters
- Labels: Clear, descriptive but brief
- Links: Use meaningful anchor text, open in new tab (target="_blank" rel="noopener noreferrer")
- Formatting:
  - Line height: 1.5-1.6 for readability
  - Font size: 0.95rem for descriptions
  - Paragraph spacing: Margin bottom 0 or minimal

## Dashboard Architecture

### File structure
```
src/
├── app/                 # Next.js App Router: layout.tsx, page.tsx, globals.css
├── App.jsx              # Main controller
├── components/          # React components (tabs, charts, calculator)
├── hooks/               # Data-fetching hooks
├── utils/               # Chart theme, downloads, policy config, API client
└── uk_budget_data/      # Python package: CLI, API, measures, pipeline
```

### Routing
- One Next.js page under the base path `/uk/autumn-budget-2026`; no client router
- Tabs and sub-tabs are query parameters (`?tab=`, `?sub=`), so links are shareable

## Performance Considerations
- Lazy loading: Delay loading indicator to avoid flash
- Memoization: Cache expensive calculations
- Request batching: Load all data in single pass when possible
- Smooth updates: Don't clear results before new data arrives
- Animation optimization: Use requestAnimationFrame

## Accessibility

### WCAG Compliance
- Semantic HTML (h1-h6 hierarchy)
- Sufficient colour contrast ratios
- Keyboard navigation support
- Focus indicators
- ARIA labels where needed

### Interactive Elements
- Clear hover states
- Descriptive button text
- Visible focus outlines
- Toggle button active states

## Download & Export Features

### Data export formats
- Each chart's download menu (`ChartDownloadMenu.jsx`, `src/utils/chartDownloads.js`) offers CSV, PNG, SVG and TXT

### Export Pattern
```javascript
// 1. Generate content
const content = generateExportContent()

// 2. Create blob
const blob = new Blob([content], { type: 'text/plain' })
const url = URL.createObjectURL(blob)

// 3. Trigger download
const link = document.createElement('a')
link.href = url
link.download = `filename-${date}.txt`
document.body.appendChild(link)
link.click()

// 4. Cleanup
document.body.removeChild(link)
URL.revokeObjectURL(url)
```

## Key Principles Summary

1. **Data accuracy first**: All numbers must be precise and properly sourced
2. **Clear visualizations**: Charts should tell the story at a glance
3. **Professional aesthetic**: Clean, modern, policy-focused design
4. **User-friendly**: Intuitive interactions, helpful descriptions
5. **Performant**: Fast load times, smooth animations
6. **Accessible**: WCAG compliant, keyboard navigable
7. **Shareable**: URL state for reproducible results
8. **British English**: All text, formatting, and locale settings
9. **Sentence case**: Everywhere, no exceptions
10. **Consistency**: Colour palette, spacing, typography throughout
