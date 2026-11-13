const DATA_URL = "data/cmip6_zonal_warming_ensmean.csv";
const MODEL_COUNT = 3;   // TODO: set to the number of models in your CSV
const HALF_WINDOW = 5;   // years averaged on each side of the selected year

const SCEN = [
    { id: "ssp126", label: "SSP1-2.6", desc: "Low Emissions", color: "#2b6cb0" },
    { id: "ssp245", label: "SSP2-4.5", desc: "Medium Emissions", color: "#dd8a1a" },
    { id: "ssp585", label: "SSP5-8.5", desc: "Very High Emissions", color: "#c0392b" }
];
const W = 600, H = 400, M = { t: 24, r: 18, b: 50, l: 84 };
const IW = W - M.l - M.r, IH = H - M.t - M.b;

const cosw = lat => Math.cos(lat * Math.PI / 180);
const fmtLat = d => d === 0 ? "0°" : Math.abs(d) + "°" + (d < 0 ? "S" : "N");
const fmtC = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + " °C";

document.getElementById("method").textContent =
    "Warming is measured relative to each climate model's 1995-2014 average. " +
    "Each point represents a 5° latitude band averaged over all longitudes, then across " + MODEL_COUNT +
    " CMIP6 climate models and an 11-year period centered on the selected year. " +
    "Regional and global averages are weighted by cos(latitude) to account for differences in surface area.";

d3.csv(DATA_URL, d3.autoType).then(init).catch(() => {
    document.getElementById("chart").textContent =
        "Could not load " + DATA_URL + ". Serve this folder with a web server (e.g. python -m http.server) instead of opening the file directly.";
});

function init(rows) {
    rows.sort((a, b) => a.lat - b.lat);
    const data = d3.group(rows, d => d.scenario, d => d.year);
    const years = [...new Set(rows.map(d => d.year))].sort(d3.ascending);
    const [y0, y1] = d3.extent(years);
    const state = { scen: "ssp585", year: Math.min(2090, y1) };

    // Mean profile (latitude -> warming) around the selected year
    function profile(scen, year) {
        const m = data.get(scen);
        const ys = d3.range(year - HALF_WINDOW, year + HALF_WINDOW + 1).filter(y => m.has(y));
        return m.get(ys[0]).map((r, i) => ({ lat: r.lat, w: d3.mean(ys, y => m.get(y)[i].warming) }));
    }
    function wmean(p, lo, hi) {
        const s = p.filter(d => d.lat >= lo && d.lat <= hi && d.w != null);
        return d3.sum(s, d => d.w * cosw(d.lat)) / d3.sum(s, d => cosw(d.lat));
    }

    // Scales (x is fixed across scenarios and years so changes are comparable)
    const x = d3.scaleLinear([Math.min(0, d3.min(rows, d => d.warming)), d3.max(rows, d => d.warming)], [0, IW]).nice();
    const y = d3.scaleLinear([-90, 90], [IH, 0]);
    const line = d3.line().defined(d => d.w != null).x(d => x(d.w)).y(d => y(d.lat)).curve(d3.curveMonotoneY);

    const svg = d3.select("#chart").append("svg").attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img").attr("aria-label", "Projected warming by latitude for the selected scenario and year");
    const g = svg.append("g").attr("transform", `translate(${M.l},${M.t})`);

    // Highlighted latitude zones
    [
        [90, 70, "#dbeafe", "Arctic"],
        [20, -20, "#eef1f4", "Tropics"]
    ].forEach(([top, bot, color, label]) => {
        g.append("rect")
            .attr("x", 0)
            .attr("y", y(top))
            .attr("width", IW)
            .attr("height", y(bot) - y(top))
            .attr("fill", color);

        g.append("text")
            .attr("class", "band-label")
            .attr("x", IW - 6)
            .attr("y", y(top) + 15)
            .attr("text-anchor", "end")
            .text(label);
    });

    g.append("g").selectAll("line").data(d3.range(-90, 91, 30)).join("line")
        .attr("x1", 0).attr("x2", IW).attr("y1", d => y(d)).attr("y2", d => y(d)).attr("stroke", "#e6ebf0");
    g.append("g").attr("transform", `translate(0,${IH})`).call(d3.axisBottom(x).ticks(7));
    g.append("g").call(d3.axisLeft(y).tickValues(d3.range(-90, 91, 30)).tickFormat(d => d === 90 ? "North Pole" : d === -90 ? "South Pole" : d === 0 ? "Equator" : fmtLat(d)));
    g.append("text").attr("class", "axis-title").attr("x", IW / 2).attr("y", IH + 40).attr("text-anchor", "middle")
        .text("Warming vs. 1995-2014 (°C)");
    g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -IH / 2).attr("y", -70)
        .attr("text-anchor", "middle").text("Latitude");

    // Shade gap between global average and curve
    let globalW = 0;
    const gap = g.append("path").attr("fill-opacity", .26);
    const gapArea = d3.area().defined(d => d.w != null).x0(() => x(globalW)).x1(d => x(d.w)).y(d => y(d.lat)).curve(d3.curveMonotoneY);

    const paths = {};
    SCEN.forEach(s => { paths[s.id] = g.append("path").attr("fill", "none").attr("stroke", s.color).attr("stroke-linejoin", "round"); });
    const gLine = g.append("line").attr("y1", 0).attr("y2", IH).attr("stroke", "#17212b").attr("stroke-dasharray", "4 4");
    const gText = g.append("text").attr("y", -8).attr("text-anchor", "middle").text("Global Average");
    const dot = g.append("circle").attr("r", 5).attr("fill", "#fff").attr("stroke-width", 2.5).style("display", "none");
    const overlay = g.append("rect").attr("width", IW).attr("height", IH).attr("fill", "none").attr("pointer-events", "all");

    // Controls
    const segBox = d3.select("#scenarios");

    segBox.selectAll("button")
        .data(SCEN)
        .join("button")
        .attr("type", "button")
        .style("--c", d => d.color)
        .html(d => `
                    <span class="scenario-name">${d.label}</span>
                    <span class="scenario-line"></span>
                    <span class="d">${d.desc}</span>
                `)
        .on("click", (e, d) => {
            state.scen = d.id;
            update();
        });
    const slider = document.getElementById("year-slider");
    slider.min = y0; slider.max = y1; slider.value = state.year;
    const playBtn = document.getElementById("play");
    let timer = null, current = [];

    function stop() { if (timer) { timer.stop(); timer = null; } playBtn.textContent = "Play"; }
    function sync() { slider.value = state.year; update(); }
    slider.addEventListener("input", () => { stop(); state.year = +slider.value; update(); });
    playBtn.addEventListener("click", () => {
        if (timer) { stop(); return; }
        if (state.year >= y1) state.year = y0;
        playBtn.textContent = "Pause";
        timer = d3.interval(() => { if (state.year >= y1) { stop(); return; } state.year++; sync(); }, 110);
    });

    function update() {
        const sc = SCEN.find(s => s.id === state.scen);
        SCEN.forEach(s => {
            const sel = s.id === state.scen;
            paths[s.id].datum(profile(s.id, state.year)).attr("d", line)
                .attr("stroke-width", sel ? 3.5 : 1.8).attr("stroke-opacity", sel ? 1 : .4)
                .attr("stroke-dasharray", sel ? null : "5 4");
        });
        paths[state.scen].raise(); overlay.raise();
        current = profile(state.scen, state.year);
        globalW = wmean(current, -90, 90);

        gap.datum(current).attr("d", gapArea).attr("fill", sc.color);

        const arctic = wmean(current, 70, 90), trop = wmean(current, -20, 20);
        const gx = x(globalW);
        gLine.attr("x1", gx).attr("x2", gx);
        gText.attr("x", gx);
        segBox.selectAll("button").attr("aria-pressed", d => d.id === state.scen);

        document.documentElement.style.setProperty("--accent", sc.color);
        document.getElementById("year-label").textContent = state.year;
        slider.style.setProperty("--p", (state.year - y0) / (y1 - y0));
        document.getElementById("s-arctic").textContent = fmtC(arctic);
        document.getElementById("s-trop").textContent = fmtC(trop);
        document.getElementById("s-global").textContent = fmtC(globalW);
        document.getElementById("s-ratio").textContent = (arctic / globalW).toFixed(1) + "x";

        document.getElementById("caption").textContent =
            "In " + state.year + ", under " + sc.desc + " (" + sc.label + "), the Arctic has warmed " + arctic.toFixed(1) + " °C" +
            (globalW > 0.05 ? ", about " + (arctic / globalW).toFixed(1) + "x the global average of " + globalW.toFixed(1) + " °C." : ".") +
            (globalW < 0.75 ? " This early, warming is still close to the baseline, so the ratio is unstable." : "");

        dot.attr("stroke", sc.color);
    }

    // Hover: nearest latitude band
    const tip = document.getElementById("tip"), chartBox = document.getElementById("chart");
    overlay.on("pointermove", e => {
        const r = overlay.node().getBoundingClientRect();
        const lat = y.invert((e.clientY - r.top) / r.height * IH);
        const d = d3.least(current.filter(p => p.w != null), p => Math.abs(p.lat - lat));
        if (!d) return;
        dot.style("display", null).attr("cx", x(d.w)).attr("cy", y(d.lat));
        const cb = chartBox.getBoundingClientRect();
        tip.textContent = fmtLat(d.lat - 2.5) + " to " + fmtLat(d.lat + 2.5) + ": " + fmtC(d.w) +
            (globalW > 0 ? " (" + (d.w / globalW).toFixed(1) + "× global)" : "");
        tip.style.display = "block"; tip.style.opacity = 1;
        // keep the tooltip inside the chart so it never widens the page
        const left = Math.max(4, Math.min(e.clientX - cb.left + 14, cb.width - tip.offsetWidth - 4));
        tip.style.left = left + "px";
        tip.style.top = Math.max(4, e.clientY - cb.top - 12) + "px";
    }).on("pointerleave", () => { tip.style.display = "none"; dot.style("display", "none"); });

    update();
}