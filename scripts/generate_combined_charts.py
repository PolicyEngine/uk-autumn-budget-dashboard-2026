"""Generate combined briefing HTML exclusively from approved artifact tables.

Usage:
    uv run python scripts/generate_combined_charts.py \
        --manifest public/data/manifest.json --key combined--measure-a+measure-b \
        --out-dir public/briefing/3/combined/
"""

import argparse
from pathlib import Path

from uk_budget_data.publication import briefing_export as export
from uk_budget_data.publication.publish import PublishError

# PolicyEngine design system colors (from app-v2/designTokens/colors.ts and dashboard)
COLORS = {
    # Primary teal from design system
    "primary": "#319795",  # teal/500
    "primary_dark": "#2C7A7B",  # teal/600
    "primary_700": "#285E61",  # teal/700 - darkest teal for "gain more than 5%"
    "primary_light": "#81E6D9",  # teal/200
    "primary_alpha_60": "#31979599",  # 60% opacity for "gain less than 5%"
    # Secondary/gray colors
    "gray_50": "#F9FAFB",
    "gray_100": "#F2F4F7",
    "gray_200": "#E2E8F0",  # No change category
    "gray_400": "#9CA3AF",  # Lose less than 5%
    "gray_500": "#6B7280",
    "gray_600": "#4B5563",  # Lose more than 5%
    "gray_700": "#344054",
    "gray_900": "#101828",
    # Amber colors for losses (from dashboard policyConfig.js)
    "amber_600": "#D97706",  # Primary loss color
    "amber_500": "#F59E0B",
    "amber_400": "#FBBF24",
    # Semantic colors
    "success": "#22C55E",
    "error": "#EF4444",
    "error_light": "#FCA5A5",
    # Chart-specific
    "background": "#FFFFFF",
    "text": "#000000",
}

# Font family from design system
FONT_FAMILY = (
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
)


def create_distributional_html(data: dict, years: list[str]) -> str:
    """Create Figure 1: Distributional impact chart (£/year by decile) with year slider."""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Distributional Impact - Combined Autumn Budget</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {{ margin: 0; padding: 16px; font-family: {FONT_FAMILY}; background: white; }}
        #chart {{ width: 100%; height: 500px; }}
    </style>
</head>
<body>
    <div id="chart"></div>
    <script>
        const data = {export.json_payload(data)};
        const years = {export.json_payload(years)};

        const traces = years.map((year, i) => {{
            const values = data[year];
            const colors = values.map(v => v >= 0 ? '{COLORS["primary"]}' : '{COLORS["amber_600"]}');
            return {{
                x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                y: values,
                type: 'bar',
                marker: {{ color: colors }},
                text: values.map(v => v >= 0 ? '+£' + Math.round(v).toLocaleString() : '-£' + Math.round(Math.abs(v)).toLocaleString()),
                textposition: 'outside',
                textfont: {{ family: "{FONT_FAMILY}", size: 10 }},
                hovertemplate: 'Decile %{{x}}<br>Change: £%{{y:,.0f}}<extra></extra>',
                visible: i === 0,
                name: year
            }};
        }});

        const steps = years.map((year, i) => ({{
            method: 'update',
            args: [{{ visible: years.map((_, j) => j === i) }}],
            label: year
        }}));

        const layout = {{
            xaxis: {{
                title: 'Income decile',
                tickmode: 'array',
                tickvals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                showgrid: true,
                gridcolor: '{COLORS["gray_200"]}'
            }},
            yaxis: {{
                title: 'Average change in household income (£/year)',
                tickprefix: '£',
                showgrid: true,
                gridcolor: '{COLORS["gray_200"]}',
                zeroline: true,
                zerolinecolor: '{COLORS["gray_700"]}',
                zerolinewidth: 2
            }},
            height: 500,
            margin: {{ l: 80, r: 50, b: 100, t: 60 }},
            font: {{ family: "{FONT_FAMILY}" }},
            showlegend: false,
            sliders: [{{
                active: 0,
                steps: steps,
                x: 0.2,
                len: 0.6,
                y: 1.1,
                currentvalue: {{ visible: false }},
                font: {{ family: "{FONT_FAMILY}" }}
            }}],
            updatemenus: [{{
                type: 'buttons',
                showactive: false,
                x: 0.1,
                y: 1.15,
                xanchor: 'right',
                buttons: [{{
                    label: 'Play',
                    method: 'animate',
                    args: [null, {{ frame: {{ duration: 1000, redraw: true }}, fromcurrent: true, mode: 'afterall' }}]
                }}]
            }}]
        }};

        // Create frames for animation
        const frames = years.map(year => ({{
            name: year,
            data: [{{
                y: data[year],
                text: data[year].map(v => v >= 0 ? '+£' + Math.round(v).toLocaleString() : '-£' + Math.round(Math.abs(v)).toLocaleString()),
                marker: {{ color: data[year].map(v => v >= 0 ? '{COLORS["primary"]}' : '{COLORS["amber_600"]}') }}
            }}]
        }}));

        Plotly.newPlot('chart', traces, layout).then(() => {{
            Plotly.addFrames('chart', frames);
        }});
    </script>
</body>
</html>"""

    return html_content


def create_winners_losers_html(data: dict, years: list[str]) -> str:
    """Create Figure 2: Winners/losers horizontal stacked bar chart with year slider."""

    y_labels = ["All", " ", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Winners and Losers - Combined Autumn Budget</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {{ margin: 0; padding: 16px; font-family: {FONT_FAMILY}; background: white; }}
        #chart {{ width: 100%; height: 650px; }}
    </style>
</head>
<body>
    <div id="chart"></div>
    <script>
        const data = {export.json_payload(data)};
        const years = {export.json_payload(years)};
        const yLabels = {export.json_payload(y_labels)};

        const categories = [
            {{ key: 'gain_more_5', name: 'Gain more than 5%', color: '{COLORS["primary_700"]}', textColor: 'white' }},
            {{ key: 'gain_less_5', name: 'Gain less than 5%', color: '{COLORS["primary_alpha_60"]}', textColor: '{COLORS["gray_700"]}' }},
            {{ key: 'no_change', name: 'No change', color: '{COLORS["gray_200"]}', textColor: '{COLORS["gray_700"]}' }},
            {{ key: 'lose_less_5', name: 'Lose less than 5%', color: '{COLORS["gray_400"]}', textColor: '{COLORS["gray_700"]}' }},
            {{ key: 'lose_more_5', name: 'Lose more than 5%', color: '{COLORS["gray_600"]}', textColor: 'white' }}
        ];

        // Create initial traces for the first artifact year
        const initialYear = years[0];
        const traces = categories.map(cat => {{
            const values = data[initialYear][cat.key];
            return {{
                name: cat.name,
                type: 'bar',
                orientation: 'h',
                x: values,
                y: yLabels,
                marker: {{ color: cat.color }},
                text: values.map(v => v !== null && v > 0.5 ? v.toFixed(1) + '%' : ''),
                textposition: 'inside',
                textfont: {{ color: cat.textColor, size: 11, family: "{FONT_FAMILY}" }},
                hovertemplate: '%{{y}}<br>' + cat.name + ': %{{x:.1f}}%<extra></extra>',
                showlegend: true
            }};
        }});

        const steps = years.map((year, i) => ({{
            method: 'animate',
            args: [[year], {{ frame: {{ duration: 800, redraw: true }}, mode: 'immediate' }}],
            label: year
        }}));

        const layout = {{
            barmode: 'stack',
            xaxis: {{
                title: {{ text: 'Population share', font: {{ family: "{FONT_FAMILY}", size: 14 }} }},
                tickfont: {{ family: "{FONT_FAMILY}", size: 12 }},
                showgrid: true,
                gridcolor: '{COLORS["gray_200"]}',
                range: [0, 100],
                tickformat: '.0f',
                ticksuffix: '%'
            }},
            yaxis: {{
                title: {{ text: 'Income decile', font: {{ family: "{FONT_FAMILY}", size: 14 }} }},
                tickfont: {{ family: "{FONT_FAMILY}", size: 12 }},
                categoryorder: 'array',
                categoryarray: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', ' ', 'All'],
                type: 'category',
                automargin: true
            }},
            height: 650,
            margin: {{ l: 80, r: 50, b: 120, t: 60 }},
            plot_bgcolor: 'white',
            paper_bgcolor: 'white',
            font: {{ family: "{FONT_FAMILY}" }},
            legend: {{
                orientation: 'h',
                yanchor: 'top',
                y: -0.12,
                xanchor: 'center',
                x: 0.5,
                font: {{ family: "{FONT_FAMILY}", size: 10 }},
                traceorder: 'normal',
                entrywidth: 100
            }},
            sliders: [{{
                active: 0,
                yanchor: 'middle',
                xanchor: 'center',
                currentvalue: {{ visible: false }},
                transition: {{ duration: 800 }},
                pad: {{ b: 10, t: 50, l: 80 }},
                len: 0.7,
                x: 0.45,
                y: 1.15,
                steps: steps
            }}],
            updatemenus: [{{
                buttons: [{{
                    args: [null, {{ frame: {{ duration: 1500, redraw: true }}, fromcurrent: true, transition: {{ duration: 800 }} }}],
                    label: 'Play',
                    method: 'animate'
                }}],
                direction: 'left',
                pad: {{ r: 10, t: 10 }},
                showactive: false,
                type: 'buttons',
                x: 0.05,
                xanchor: 'left',
                y: 1.15,
                yanchor: 'middle'
            }}]
        }};

        // Create frames for animation
        const frames = years.map(year => ({{
            name: year,
            data: categories.map(cat => {{
                const values = data[year][cat.key];
                return {{
                    x: values,
                    text: values.map(v => v !== null && v > 0.5 ? v.toFixed(1) + '%' : '')
                }};
            }})
        }}));

        Plotly.newPlot('chart', traces, layout).then(() => {{
            Plotly.addFrames('chart', frames);
        }});
    </script>
</body>
</html>"""

    return html_content


def create_poverty_html(data: dict, years: list[str]) -> str:
    """Create Figure 4: Poverty impact chart with toggles for absolute/relative and BHC/AHC."""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Poverty Impact - Combined Autumn Budget</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {{ margin: 0; padding: 16px; font-family: {FONT_FAMILY}; background: white; }}
        #chart {{ width: 100%; height: 450px; }}
        .controls {{
            display: flex;
            gap: 24px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }}
        .toggle-group {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        .toggle-label {{
            font-size: 14px;
            color: {COLORS["gray_700"]};
            font-weight: 500;
        }}
        .toggle-buttons {{
            display: flex;
            border: 1px solid {COLORS["gray_200"]};
            border-radius: 6px;
            overflow: hidden;
        }}
        .toggle-btn {{
            padding: 6px 12px;
            border: none;
            background: white;
            cursor: pointer;
            font-size: 13px;
            font-family: {FONT_FAMILY};
            color: {COLORS["gray_500"]};
            transition: all 0.2s;
        }}
        .toggle-btn:not(:last-child) {{
            border-right: 1px solid {COLORS["gray_200"]};
        }}
        .toggle-btn.active {{
            background: {COLORS["primary"]};
            color: white;
        }}
        .toggle-btn:hover:not(.active) {{
            background: {COLORS["gray_100"]};
        }}
    </style>
</head>
<body>
    <div class="controls">
        <div class="toggle-group">
            <span class="toggle-label">Poverty measure:</span>
            <div class="toggle-buttons" id="measure-toggle">
                <button class="toggle-btn active" data-value="absolute">Absolute</button>
                <button class="toggle-btn" data-value="relative">Relative</button>
            </div>
        </div>
        <div class="toggle-group">
            <span class="toggle-label">Housing costs:</span>
            <div class="toggle-buttons" id="housing-toggle">
                <button class="toggle-btn active" data-value="bhc">Before (BHC)</button>
                <button class="toggle-btn" data-value="ahc">After (AHC)</button>
            </div>
        </div>
    </div>
    <div id="chart"></div>
    <script>
        const povertyData = {export.json_payload(data)};
        const years = {export.json_payload(years)};
        const demographics = ['Overall', 'Child', 'Working-age', 'Pensioner'];
        const colors = {{
            'Overall': '{COLORS["primary"]}',
            'Child': '{COLORS["primary_dark"]}',
            'Working-age': '{COLORS["gray_500"]}',
            'Pensioner': '{COLORS["gray_400"]}'
        }};

        let currentMeasure = 'absolute';
        let currentHousing = 'bhc';

        function updateChart() {{
            const data = povertyData[currentMeasure][currentHousing];

            const traces = demographics.map(demo => ({{
                x: years,
                y: years.map(year => data[demo][year]),
                type: 'scatter',
                mode: 'lines+markers',
                name: demo,
                line: {{ color: colors[demo], width: 2 }},
                marker: {{ size: 6 }},
                hovertemplate: demo + '<br>%{{x}}: %{{y:+.1f}}pp<extra></extra>'
            }}));

            const layout = {{
                xaxis: {{
                    title: 'Fiscal year',
                    tickfont: {{ family: "{FONT_FAMILY}", size: 12 }},
                    showgrid: true,
                    gridcolor: '{COLORS["gray_200"]}'
                }},
                yaxis: {{
                    title: 'Change in poverty rate (pp)',
                    ticksuffix: 'pp',
                    showgrid: true,
                    gridcolor: '{COLORS["gray_200"]}',
                    zeroline: true,
                    zerolinecolor: '{COLORS["gray_700"]}',
                    zerolinewidth: 2,
                    autorange: true
                }},
                height: 450,
                margin: {{ l: 70, r: 50, b: 60, t: 20 }},
                font: {{ family: "{FONT_FAMILY}" }},
                legend: {{
                    orientation: 'h',
                    yanchor: 'bottom',
                    y: -0.25,
                    xanchor: 'center',
                    x: 0.5,
                    font: {{ family: "{FONT_FAMILY}", size: 12 }}
                }},
                hovermode: 'x unified'
            }};

            Plotly.react('chart', traces, layout);
        }}

        // Toggle button handlers
        document.querySelectorAll('#measure-toggle .toggle-btn').forEach(btn => {{
            btn.addEventListener('click', function() {{
                document.querySelectorAll('#measure-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentMeasure = this.dataset.value;
                updateChart();
            }});
        }});

        document.querySelectorAll('#housing-toggle .toggle-btn').forEach(btn => {{
            btn.addEventListener('click', function() {{
                document.querySelectorAll('#housing-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentHousing = this.dataset.value;
                updateChart();
            }});
        }});

        // Initial render
        updateChart();
    </script>
</body>
</html>"""

    return html_content


def create_constituency_map_html(data_by_year: dict, years: list[str]) -> str:
    """Create the map from the optional receipted constituency table."""
    if not any(data_by_year.values()):
        return """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Constituency map</title></head>
<body><p>Constituency map unavailable: the approved artifact has no constituency table.</p></body></html>"""

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Constituency Map - Combined Autumn Budget</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {{ margin: 0; overflow: hidden; background: white; font-family: {FONT_FAMILY}; }}
        svg {{ display: block; }}
        .tooltip {{
            position: fixed;
            background: white;
            padding: 10px 14px;
            border-radius: 6px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            pointer-events: none;
            opacity: 0;
            font-size: 13px;
            z-index: 1001;
        }}
        .tooltip strong {{ display: block; margin-bottom: 4px; }}
        .tooltip .value {{ font-weight: 600; }}
        .gain {{ color: {COLORS["primary"]}; }}
        .loss {{ color: {COLORS["amber_600"]}; }}
        .controls {{
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 15px;
            z-index: 1000;
        }}
        .play-btn {{
            width: 36px;
            height: 36px;
            border: none;
            background: {COLORS["primary"]};
            color: white;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .year-slider {{
            width: 200px;
            height: 6px;
            -webkit-appearance: none;
            background: {COLORS["gray_200"]};
            border-radius: 3px;
        }}
        .year-slider::-webkit-slider-thumb {{
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            background: {COLORS["primary"]};
            border-radius: 50%;
            cursor: pointer;
        }}
        .year-marks {{
            display: flex;
            justify-content: space-between;
            width: 200px;
            font-size: 9px;
            color: {COLORS["gray_500"]};
            margin-top: 4px;
        }}
        .legend {{
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: white;
            padding: 10px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            font-size: 11px;
        }}
        .legend-bar {{
            width: 150px;
            height: 12px;
            border-radius: 2px;
        }}
        .legend-labels {{
            display: flex;
            justify-content: space-between;
            margin-top: 4px;
        }}
        .zoom-controls {{
            position: absolute;
            bottom: 20px;
            left: 20px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }}
        .zoom-btn {{
            width: 32px;
            height: 32px;
            border: 1px solid {COLORS["gray_200"]};
            background: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 18px;
        }}
    </style>
</head>
<body>
    <div class="controls">
        <button class="play-btn" id="play-btn">&#9654;</button>
        <div>
            <input type="range" class="year-slider" id="year-slider" min="0" max="{len(years) - 1}" value="0" step="1">
            <div class="year-marks">
                {"".join(f"<span>{y}</span>" for y in years)}
            </div>
        </div>
    </div>
    <div class="zoom-controls">
        <button class="zoom-btn" id="zoom-in">+</button>
        <button class="zoom-btn" id="zoom-out">−</button>
        <button class="zoom-btn" id="zoom-reset">⟲</button>
    </div>
    <div class="legend">
        <div class="legend-bar" id="legend-bar"></div>
        <div class="legend-labels">
            <span id="legend-min"></span>
            <span id="legend-max"></span>
        </div>
    </div>
    <svg id="map"></svg>
    <div class="tooltip" id="tooltip"></div>
    <script>
        const dataByYear = {export.json_payload(data_by_year)};
        const years = {export.json_payload(years)};
        let currentYearIndex = 0;

        // Calculate global absMax across all years for consistent legend
        let globalAbsMax = 0;
        years.forEach(year => {{
            const yearData = dataByYear[year] || {{}};
            Object.values(yearData).forEach(d => {{
                if (d && !isNaN(d.value)) {{
                    globalAbsMax = Math.max(globalAbsMax, Math.abs(d.value));
                }}
            }});
        }});
        // The legend uses the largest receipted chart value.
        let isPlaying = false;
        let playInterval;

        const width = window.innerWidth;
        const height = window.innerHeight;

        const svg = d3.select("#map")
            .attr("width", width)
            .attr("height", height);

        const g = svg.append("g");

        const zoom = d3.zoom()
            .scaleExtent([0.5, 8])
            .on("zoom", (event) => g.attr("transform", event.transform));

        svg.call(zoom);

        // Load GeoJSON - using GSScode property for matching
        // Note: GeoJSON uses British National Grid (EPSG:27700) coordinates, not WGS84
        // Use geoIdentity with fitSize since coordinates are already projected
        d3.json("/data/uk_constituencies_2024.geojson").then(geojson => {{
            const projection = d3.geoIdentity()
                .reflectY(true)  // BNG y-axis is inverted relative to SVG
                .fitSize([width - 100, height - 150], geojson);

            const path = d3.geoPath().projection(projection);

            // Set up fixed legend (consistent across all years)
            document.getElementById("legend-min").textContent = "-£" + globalAbsMax;
            document.getElementById("legend-max").textContent = "+£" + globalAbsMax;
            document.getElementById("legend-bar").style.background =
                `linear-gradient(to right, {COLORS["amber_600"]}, white, {COLORS["primary"]})`;

            const colorScale = d3.scaleLinear()
                .domain([-globalAbsMax, 0, globalAbsMax])
                .range(["{COLORS["amber_600"]}", "white", "{COLORS["primary"]}"]);

            function updateMap() {{
                const yearLabel = years[currentYearIndex];
                const yearData = dataByYear[yearLabel] || {{}};

                const paths = g.selectAll("path")
                    .data(geojson.features, d => d.properties.GSScode);

                paths.enter()
                    .append("path")
                    .attr("d", path)
                    .attr("stroke", "#fff")
                    .attr("stroke-width", 0.3)
                    .merge(paths)
                    .attr("fill", d => {{
                        const code = d.properties.GSScode;
                        const data = yearData[code];
                        return data ? colorScale(data.value) : "{COLORS["gray_200"]}";
                    }})
                    .on("mouseover", function(event, d) {{
                        const code = d.properties.GSScode;
                        const data = yearData[code];
                        if (data) {{
                            const tooltip = document.getElementById("tooltip");
                            const sign = data.value >= 0 ? '+' : '-';
                            tooltip.innerHTML = `<strong>${{data.name}}</strong>` +
                                `<span class="${{data.value >= 0 ? 'gain' : 'loss'}} value">` +
                                `${{sign}}£${{Math.round(Math.abs(data.value)).toLocaleString()}}/year</span>`;
                            tooltip.style.opacity = 1;
                            tooltip.style.left = (event.clientX + 15) + "px";
                            tooltip.style.top = (event.clientY + 15) + "px";
                        }}
                        d3.select(this).attr("stroke", "{COLORS["gray_700"]}").attr("stroke-width", 1.5);
                    }})
                    .on("mouseout", function() {{
                        document.getElementById("tooltip").style.opacity = 0;
                        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.3);
                    }});
            }}

            updateMap();

            document.getElementById("year-slider").addEventListener("input", function() {{
                currentYearIndex = parseInt(this.value);
                updateMap();
            }});

            document.getElementById("play-btn").addEventListener("click", function() {{
                if (isPlaying) {{
                    clearInterval(playInterval);
                    this.innerHTML = "&#9654;";
                }} else {{
                    playInterval = setInterval(() => {{
                        currentYearIndex = (currentYearIndex + 1) % years.length;
                        document.getElementById("year-slider").value = currentYearIndex;
                        updateMap();
                    }}, 1500);
                    this.innerHTML = "&#9724;";
                }}
                isPlaying = !isPlaying;
            }});

            document.getElementById("zoom-in").addEventListener("click", () =>
                svg.transition().call(zoom.scaleBy, 1.5));
            document.getElementById("zoom-out").addEventListener("click", () =>
                svg.transition().call(zoom.scaleBy, 0.67));
            document.getElementById("zoom-reset").addEventListener("click", () =>
                svg.transition().call(zoom.transform, d3.zoomIdentity));
        }}).catch(error => {{
            console.error("Error loading GeoJSON:", error);
            document.getElementById("map").outerHTML = '<div style="padding: 20px; color: {COLORS["error"]};">Error loading map data. Please check the GeoJSON file path.</div>';
        }});
    </script>
</body>
</html>"""

    return html_content


def chart_data(artifact: dict) -> tuple[dict, dict, dict, dict]:
    """Round only values present in the corresponding artifact tables."""
    years = export.supported_years(artifact)
    labels = export.year_labels(artifact, years)
    tables = artifact["tables"]
    distributional, winners_losers, poverty, constituencies = {}, {}, {}, {}
    group_labels = {
        "overall": "Overall",
        "child": "Child",
        "working_age": "Working-age",
        "pensioner": "Pensioner",
    }
    categories = (
        "gain_more_5",
        "gain_less_5",
        "no_change",
        "lose_less_5",
        "lose_more_5",
    )
    deciles = ["all", *[str(n) for n in range(10, 0, -1)]]
    for year, label in zip(years, labels, strict=True):
        decile_rows = {
            row["decile"]: row
            for row in tables["briefing_deciles"]
            if row["year"] == year
        }
        distributional[label] = [
            round(decile_rows[str(n)]["avg_change_gbp"], 1)
            for n in range(1, 11)
        ]
        share_rows = {
            (row["decile"], row["category"]): row
            for row in tables["briefing_winners_losers"]
            if row["year"] == year
        }
        winners_losers[label] = {
            category: [
                round(share_rows[(decile, category)]["share_pct"], 1)
                for decile in deciles
            ]
            for category in categories
        }
        # A visual spacer between All and the deciles carries no number.
        for shares in winners_losers[label].values():
            shares.insert(1, None)
        for row in tables["briefing_poverty"]:
            if row["year"] == year:
                poverty.setdefault(row["measure"], {}).setdefault(
                    row["housing"], {}
                ).setdefault(group_labels[row["group"]], {})[label] = round(
                    row["change_pp"], 1
                )
        constituencies[label] = {
            row["constituency_code"]: {
                "name": row["constituency_name"],
                "value": round(row["average_gain"], 1),
            }
            for row in tables.get("constituency", [])
            if row["year"] == year
        }
    return distributional, winners_losers, poverty, constituencies


def generate(
    manifest: Path,
    key: str,
    out_dir: Path,
    *,
    inputs: Path = Path("data_inputs/treasury"),
) -> dict:
    """Preflight the combined artifact, prepare every chart, then write it."""
    with export.gated(manifest, [key], inputs=inputs) as loaded:
        artifact = loaded["entries"][key]
        if not artifact["entry"].measures:
            raise PublishError("export", [f"{key} is not a combined artifact"])
        export.require_tables(
            key,
            artifact,
            (
                "briefing_deciles",
                "briefing_winners_losers",
                "briefing_poverty",
            ),
        )
        distributional, winners_losers, poverty, constituencies = chart_data(
            artifact
        )
        years = export.year_labels(artifact)
        source = export.source_line(artifact, loaded["stamp"])
        charts = {
            "distributional.html": (
                create_distributional_html(distributional, years),
                distributional,
            ),
            "winners_losers.html": (
                create_winners_losers_html(winners_losers, years),
                winners_losers,
            ),
            "poverty_inequality.html": (
                create_poverty_html(poverty, years),
                poverty,
            ),
            "constituency_map.html": (
                create_constituency_map_html(constituencies, years),
                constituencies,
            ),
        }
        outputs = {
            name: export.stamp_html(content, source, loaded["stamp"], payload)
            for name, (content, payload) in charts.items()
        }
        return export.write_export(out_dir, outputs, loaded)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--inputs", type=Path, default=Path("data_inputs/treasury")
    )
    args = parser.parse_args(argv)
    try:
        receipt = generate(
            args.manifest, args.key, args.out_dir, inputs=args.inputs
        )
    except (PublishError, ValueError, OSError) as error:
        print(f"Briefing export refused: {error}")
        return 1
    print(
        f"Exported {len(receipt['files'])} charts from publication manifest "
        f"rev {receipt['manifest_revision']} to {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
