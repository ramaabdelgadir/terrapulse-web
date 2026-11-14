"use strict";

const Landing = (() => {
  let built = false, globe = null;

  const NOTES = [
    { v: "ndvi", r: "new_delta", feature: true, kicker: "Desert reclamation, west of the Delta" },
    { v: "no2", r: "greater_cairo", kicker: "The air above a megacity" },
    { v: "precip", r: "north_coast", kicker: "Egypt’s rainiest strip of coast" },
    { v: "station_temp", r: "alexandria", kicker: "A thermometer on the ground" },
    { v: "precip", r: "amazon", kicker: "The other side of the world" },
  ];

  function noteChart(r, col, big) {
    const ys = r.annual.value, xs = r.annual.year, tr = r.lines.trend;
    const vals = ys.concat(tr).concat(r.lines.fan ? r.lines.fan.flat() : []).filter((v) => v != null && isFinite(v));
    const lo = Math.min(...vals), hi = Math.max(...vals), W = 520, H = big ? 250 : 190, L = 18, R = 18, T = 16, B = 26;
    const X = (i) => L + (W - L - R) * i / (xs.length - 1), Y = (v) => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1));
    const jk = r.lines.jump_year ? xs.findIndex((y) => y + .5 >= r.lines.jump_year) : -1;
    let fan = "";
    if (r.lines.fan) {
      const [a, b] = r.lines.fan;
      fan = `<path d="${a.map((v, i) => `${i ? "L" : "M"}${X(i)} ${Y(v)}`).join("")}${b.map((v, i) => `L${X(b.length - 1 - i)} ${Y(b[b.length - 1 - i])}`).join("")}Z" fill="${hexA(col, .14)}"/>`;
    }
    let t = "", on = false;
    tr.forEach((v, i) => { if (i === jk) on = false; if (v == null) { on = false; return; } t += `${on ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; on = true; });
    const dots = ys.map((v, i) => v == null ? "" : `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.4"/>`).join("");
    const ticks = xs.map((y, i) => (y % 5 === 0) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${y}</text>` : "").join("");
    const jump = jk > 0 ? `<line x1="${X(jk) - (X(1) - X(0)) / 2}" x2="${X(jk) - (X(1) - X(0)) / 2}" y1="${T}" y2="${H - B}" stroke="${col}" stroke-dasharray="4 4"/><text x="${X(jk) - (X(1) - X(0)) / 2 - 4}" y="${T - 4}" text-anchor="end" class="jt" fill="${col}">sudden jump →</text>` : "";
    return `<svg class="note-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yearly averages from ${xs[0]} to ${xs[xs.length - 1]} with the TerraPulse trend line">
      ${fan}<g class="dots">${dots}</g><path d="${t}" fill="none" stroke="${col}" stroke-width="3.2" stroke-linecap="round"/>${jump}<g class="ticks">${ticks}</g></svg>`;
  }

  async function discoveries() {
    const box = $("#discoveries");
    const ok = NOTES.filter((n) => { const v = varById(n.v); return v && (v.regions_avail || []).includes(n.r); });
    const res = await Promise.all(ok.map((n) => api(`/api/region/${n.v}/${n.r}`).catch(() => null)));
    const items = ok.map((n, i) => [n, res[i]]).filter(([, r]) => r && !r.error);
    if (!items.length) { box.innerHTML = `<p>The pipeline didn’t answer. Run <code>python run_pipeline.py</code> and reload.</p>`; return; }
    box.innerHTML = items.map(([n, r], i) => {
      const sel = { kind: "region", id: n.r };
      const col = Analysis.trendColor(r);
      const [lo, hi] = r.slope_ci95 || [null, null];
      return `<article class="note ${n.feature ? "feature" : ""} f-${verdictFamily(r.verdict)}" style="--tc:${col}">
        <p class="note-kicker mono"><span>${String(i + 1).padStart(2, "0")}</span>${esc(n.kicker)}</p>
        ${badgeHTML(r.verdict)}
        <h3>${esc(headline(r, sel))}</h3>
        ${noteChart(r, col, n.feature)}
        ${n.feature ? `<p class="note-plain">${esc(Analysis.subText(r))} ${esc(Analysis.interpretation(r))}</p>` : ""}
        <dl class="note-nums">
          <div><dt>Rate</dt><dd>${fmt(r.slope_per_decade)} <small>${esc(SHORT_UNITS(r.units))}/decade</small></dd></div>
          <div><dt>95% range</dt><dd>${fmt(lo * 10)} to ${fmt(hi * 10)}</dd></div>
          <div><dt>Record</dt><dd>${Math.round(r.record_years)} yrs</dd></div>
        </dl>
        <p class="note-src mono">${esc(r.source)}</p>
        <button class="note-open" data-v="${n.v}" data-r="${n.r}">Open this investigation <span>→</span></button>
      </article>`;
    }).join("");
    $$("#discoveries .note-open").forEach((b) => b.addEventListener("click", () => openInvestigation(b.dataset.v, { kind: "region", id: b.dataset.r })));
  }

  function instruments() {
    $("#instruments").innerHTML = state.meta.variables.map((v, i) => `
      <li style="--neg:${v.neg};--pos:${v.pos}">
        <span class="ins-n mono">${String(i + 1).padStart(2, "0")}</span>
        <span class="ins-glyph">${glyph(v.id)}</span>
        <div class="ins-main"><h3>${esc(varShort(v))}</h3><p>${esc(v.definition)}</p></div>
        <div class="ins-side">
          <p class="mono ins-src">${esc(instrumentOf(v))}</p>
          <div class="ins-ramp"><i></i><span class="mono"><b>${esc(v.neg_word)}</b><b>${esc(v.pos_word)}</b></span></div>
          <p class="mono ins-meta">${esc(SHORT_UNITS(v.units) || v.units)} · ${v.gridded ? "map + " + (v.regions_avail || []).length + " regions" : (v.regions_avail || []).length + " region" + ((v.regions_avail || []).length > 1 ? "s" : "")}</p>
        </div>
        <button class="ins-go" data-v="${v.id}" aria-label="Explore ${esc(varShort(v))}">Explore →</button>
      </li>`).join("");
    $$("#instruments .ins-go").forEach((b) => b.addEventListener("click", () => openInvestigation(b.dataset.v)));
  }

  const ILL = {
    choose: `<svg viewBox="0 0 220 140" aria-hidden="true"><rect x="10" y="10" width="200" height="120" rx="14" fill="#22353b"/>
      ${Array.from({ length: 6 }, (_, r) => Array.from({ length: 10 }, (_, c) => `<rect x="${22 + c * 18}" y="${22 + r * 17}" width="15" height="14" rx="2" fill="${(r + c) % 5 === 0 ? "#2F7A4F" : (r * c) % 7 === 3 ? "#8C5A24" : "#35505a"}" opacity="${(r + c) % 3 ? .9 : .55}"/>`).join("")).join("")}
      <rect x="74" y="40" width="74" height="54" rx="4" fill="none" stroke="#7FBF86" stroke-width="2.5" stroke-dasharray="6 4"/>
      <path d="M150 96l10 26 5-10 11 5z" fill="#fff" stroke="#eef3ec" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    investigate: `<svg viewBox="0 0 220 140" aria-hidden="true"><rect x="10" y="10" width="200" height="120" rx="14" fill="#fff" stroke="#3c565e"/>
      <path d="M26 104 ${Array.from({ length: 22 }, (_, i) => `L${26 + i * 8} ${100 - i * 2.4 - 14 * Math.sin(i * 1.1) * (i % 3 ? .6 : 1)}`).join(" ")}" fill="none" stroke="#7cc6d6" stroke-width="2" opacity=".7"/>
      <path d="M26 104L194 50" stroke="#7FBF86" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M26 112L194 62L194 40L26 96Z" fill="rgba(127,191,134,.12)"/></svg>`,
    understand: `<svg viewBox="0 0 220 140" aria-hidden="true"><rect x="10" y="10" width="200" height="120" rx="14" fill="#fff" stroke="#3c565e"/>
      <rect x="28" y="30" width="142" height="30" rx="15" fill="#fff" stroke="#0a9a7a" stroke-width="2.5"/><circle cx="45" cy="45" r="9" fill="#0a9a7a"/><path d="M40 45l4 4 6-7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <rect x="60" y="40" width="94" height="9" rx="4.5" fill="#c9d8d4"/>
      <rect x="28" y="74" width="164" height="8" rx="4" fill="#d6e4e0"/><rect x="28" y="88" width="132" height="8" rx="4" fill="#d6e4e0"/><rect x="28" y="102" width="96" height="8" rx="4" fill="#d6e4e0"/></svg>`,
  };

  function video() {
    const v = $("#intro-video"), btn = $("#monitor-start");
    const play = () => { btn.hidden = true; v.controls = true; v.play().catch(() => {}); };
    btn.addEventListener("click", () => { play(); v.focus(); });
    v.addEventListener("play", () => { btn.hidden = true; v.controls = true; });
    const marks = $$("#chapters button").map((b) => [+b.dataset.t, b]);
    v.addEventListener("timeupdate", () => {
      let cur = marks[0][1];
      marks.forEach(([t, b]) => { if (v.currentTime + 0.25 >= t) cur = b; });
      marks.forEach(([, b]) => b.classList.toggle("on", b === cur));
    });
    marks.forEach(([t, b]) => b.addEventListener("click", () => { v.currentTime = t; play(); }));
    Bus.on("route", (r) => { if (r !== "landing" && !v.paused) v.pause(); });
  }

  function clock() {
    const t = () => { const d = new Date(); $("#ld-clock").textContent = `UTC ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
    t(); setInterval(t, 30000);
  }

  function build() {
    if (built) return;
    built = true;
    $("#ld-sami").innerHTML = samiSVG({ pose: "wave", face: "happy" });
    $("#ld-final-sami").innerHTML = samiSVG({ pose: "point", face: "wink" });
    $$(".how-ill").forEach((d) => (d.innerHTML = ILL[d.dataset.ill]));
    globe = Globe.make($("#globe"));
    globe.start();
    video(); clock();
    if (state.meta) { instruments(); discoveries(); }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12 });
    $$(".landing section, .how-steps li, .instruments").forEach((s) => io.observe(s));
  }
  Bus.on("meta", () => { if (built) { instruments(); discoveries(); } });

  return { build };
})();
