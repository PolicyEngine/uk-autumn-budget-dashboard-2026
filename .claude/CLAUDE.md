# UK Autumn Budget Dashboard - Style & Architecture Guide

When working on the UK Autumn Budget dashboard project, follow these comprehensive guidelines:

## Critical: Dependency Management

### uv.lock Controls Installed Versions
**IMPORTANT**: The `uv.lock` file pins exact dependency versions. Manual `uv pip install` commands will be overridden by the lockfile on next `uv sync`.

When upgrading dependencies (especially policyengine-uk):
```bash
# CORRECT: Upgrade via lockfile
uv lock --upgrade-package policyengine-uk
uv sync

# WRONG: This will be overridden by uv.lock
uv pip install policyengine-uk==X.Y.Z
```

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

The reforms in `src/uk_budget_data/reforms.py` assume current law = Autumn Budget policy, with baseline parameter changes setting pre-budget values to show policy impact.

## Visual Style Guide

### Colour Palette
- **Primary colour**: Teal `#319795` - use for main actions, highlights, and primary data series
- **Secondary colours for charts**:
  - `#5A8FB8` (Blue-grey)
  - `#B8875A` (Tan)
  - `#5FB88A` (Mint)
  - `#4A7BA7` (Steel blue)
  - `#C59A5A` (Gold)
- **Neutral grey for baseline data**: `#9CA3AF`
- **Text colours**:
  - Primary text: `#374151`
  - Secondary text: `#4B5563`
  - Muted text: `#666`

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

### Tech Stack
- **Framework**: React 18.2+ with Vite
- **Charts**: Recharts 3.2+ (built on D3)
- **State management**: React hooks (useState, useEffect, useRef, useMemo)
- **No UI library**: Custom CSS for full control

### Key Components

#### App.jsx (Main Controller)
- Manages global state (selectedPolicies, policyParams, results)
- Handles URL synchronization (policies and parameters in query string)
- CSV data fetching and parsing
- Auto-runs analysis when policies/parameters change
- Coordinates between Sidebar and Results

#### Sidebar.jsx
- Policy selection (checkboxes)
- Parameter configuration (sliders, number inputs)
- Year selector (if needed)
- Compact, sticky sidebar design

#### Results.jsx
- Introduction section with external links
- Multiple chart sections with descriptions
- Chart toggles (e.g., reduction vs absolute rate)
- Distributional analysis with year selector
- CSV/TXT data export functionality
- AnimatedNumber component for smooth value transitions

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
- Heights: 350px standard for all charts
- Margins: Left margin 90px to accommodate rotated Y-axis labels
- Grid: Light grey #e0e0e0, dashed 3 3
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

### CSV Data Structure
- Comprehensive data file: /data/all-results.csv
- Distributional analysis files: /data/distributional-analysis-{policy}-{year}-{params}.csv
- Parse with string split (no heavy CSV library needed)
- Handle parameter matching for policies with configurable values

### Data Processing Pattern
```javascript
// 1. Fetch CSV
const response = await fetch('/data/filename.csv')
const csvText = await response.text()

// 2. Parse lines
const lines = csvText.trim().split('\n')

// 3. Process (skip header at index 0)
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',')
  // Extract and convert values
}
```

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

### File Structure
```
src/
├── App.jsx              # Main controller
├── App.css              # App-level styles
├── main.jsx             # Entry point
├── index.css            # Global styles
└── components/
    ├── Sidebar.jsx      # Policy selection & params
    ├── Sidebar.css
    ├── PolicyForm.jsx   # Parameter configuration
    ├── PolicyForm.css
    ├── Results.jsx      # Charts & analysis display
    └── Results.css
```

### Routing
- No router needed: Single page application
- URL state: Use query parameters for shareable links
- Navigation: Internal sections only

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

### Data Export Formats
- TXT: Human-readable formatted text
- CSV: Machine-readable structured data
- Both include metadata (generation date, policy names)

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
