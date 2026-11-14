/* Home (mission board), My Analyses (logbook), Learn & Discover, Settings. */
"use strict";

/* The original "Start an investigation" case files, unchanged. */
const CASES = [
  { v: "ndvi", r: "new_delta", cmp: "alexandria", title: "A desert turned into farmland",
    q: "Egypt is reclaiming desert west of the Delta while cities like Alexandria spread over old fields. Can a satellite see both?" },
  { v: "lst", r: "greater_cairo", title: "A growing megacity",
    q: "Is the ground in Greater Cairo getting hotter, and faster than the farmland around it?", cmp: "nile_delta" },
  { v: "no2", r: "greater_cairo", cmp: "nile_delta", title: "The air above a big city",
    q: "Is the air over Cairo getting cleaner or more polluted? Compare it with the whole Delta." },
  { v: "precip", r: "north_coast", title: "Rain on the Mediterranean coast",
    q: "Egypt’s little rain falls mostly near Alexandria in winter. Is it changing, or is it too variable to tell?" },
  { v: "station_temp", r: "alexandria", title: "Checking satellites against the ground",
    q: "A real thermometer at Alexandria airport since 2000. Is it warming, and is the record itself trustworthy?" },
  { v: "lst", r: "alexandria", cmp: "new_delta", title: "Does the satellite agree with the thermometer?",
    q: "MODIS measures the ground’s skin temperature from space. Over Alexandria, does it warm as fast as the airport station? And why does new farmland stay cooler?" },
  { v: "precip", r: "amazon", cmp: null, title: "Rain in the Amazon",
    q: "One of the wettest places on Earth. Has its rainfall shifted over 25+ years?" },
];

async function openInvestigation(v, sel, cmp) {
  const p = Explorer.open(v, sel, cmp);
  location.hash = "#/explorer";
  await p;
}

const Pages = (() => {
  let trustCache = {};
  const trust = async (v) => trustCache[v] || (trustCache[v] = await api(`/api/trust/${v}`).catch(() => null));

  /* ---------------------------------------------------------------- home */
  function home() {
    const now = new Date(), h = now.getHours();
    $("#home-hello").textContent = h < 5 ? "Night shift, explorer?" : h < 12 ? "Good morning, explorer." : h < 18 ? "Good afternoon, explorer." : "Good evening, explorer.";
    $("#home-date").textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).toUpperCase() + " · MISSION BOARD";
    if (!$("#home-sami").firstChild) $("#home-sami").innerHTML = samiSVG({ pose: "hold", face: "happy" });

    const avail = (c) => { const v = varById(c.v); return v && (v.regions_avail || []).includes(c.r); };
    $("#cases").innerHTML = CASES.filter(avail).map((c, i) => {
      const v = varById(c.v);
      const place = cap((PLACE[c.r] || c.r).replace(/^the /, ""));
      return `<li><button class="case" data-i="${CASES.indexOf(c)}" style="--neg:${v.neg};--pos:${v.pos}">
        <span class="case-n mono">${String(i + 1).padStart(2, "0")}</span>
        <span class="case-glyph">${glyph(v.id)}</span>
        <span class="case-body"><b>${esc(c.title)}</b><span>${esc(c.q)}</span>
          <small class="mono">${esc(varShort(v))} · ${esc(place)}${c.cmp && (v.regions_avail || []).includes(c.cmp) ? ` vs ${esc(cap((PLACE[c.cmp] || c.cmp).replace(/^the /, "")))}` : ""} · ${esc(instrumentOf(v))}</small></span>
        <span class="case-go" aria-hidden="true">→</span></button></li>`;
    }).join("");
    $$("#cases .case").forEach((b) => b.addEventListener("click", () => {
      const c = CASES[+b.dataset.i]; openInvestigation(c.v, { kind: "region", id: c.r }, c.cmp);
    }));

    $("#board-list").innerHTML = state.meta.variables.map((v) => `<li data-v="${v.id}">${glyph(v.id)}<span><b>${esc(varShort(v))}</b><small class="mono">${esc(instrumentOf(v))}</small></span><em class="mono" data-period>…</em></li>`).join("");
    state.meta.variables.forEach(async (v) => {
      const t = await trust(v.id);
      const c = t && t.cleaning;
      const li = $(`#board-list li[data-v="${v.id}"] [data-period]`);
      if (li) li.textContent = c && c.record_start ? `${c.record_start.slice(0, 4)}–${(c.record_end || "").slice(0, 4)}` : "";
    });
    renderRecent();
  }
  function renderRecent() {
    const h = Logbook.history().slice(0, 4);
    $("#recent-list").innerHTML = h.length ? h.map((e, i) => `<li><button data-i="${i}">${badgeHTML(e.verdict, false)}<span>${esc(e.title)}</span><small class="mono">${when(e.at)}</small></button></li>`).join("")
      : `<li class="empty">Nothing yet. Your findings will appear here.</li>`;
    $$("#recent-list button").forEach((b) => b.addEventListener("click", () => { const e = h[+b.dataset.i]; openInvestigation(e.v, e.sel); }));
    const last = h[0];
    const rb = $("#home-resume");
    rb.hidden = !last;
    if (last) { rb.querySelector("span").textContent = `${last.place}, ${SHORT_LABEL[last.v] || last.varLabel}`; rb.onclick = () => openInvestigation(last.v, last.sel); }
  }

  /* ---------------------------------------------------------------- my analyses */
  function logItem(e, i, kind) {
    return `<li class="log-item">
      <span class="log-when mono">${new Date(e.at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}<br>${new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      <span class="log-dot" aria-hidden="true"></span>
      <div class="log-body">${badgeHTML(e.verdict, false)}<h3>${esc(e.title)}</h3><p class="mono">${esc(e.varLabel)} · ${esc(e.place)}${e.sel.kind === "box" ? " (drawn box)" : e.sel.kind === "pixel" ? " (grid cell)" : ""}</p>
        <div class="log-actions"><button class="btn btn-small" data-open="${kind}:${i}">Open on the map</button>
        ${kind === "s" ? `<button class="btn btn-quiet btn-small" data-rm="${esc(e.key)}">Remove</button>` : ""}</div></div></li>`;
  }
  function analyses() {
    const s = Logbook.saved(), h = Logbook.history();
    $("#saved-list").innerHTML = s.length ? s.map((e, i) => logItem(e, i, "s")).join("")
      : `<li class="log-empty">${samiSVG({ pose: "point", face: "neutral" })}<div><b>No saved findings yet.</b><p>Open any result in the Earth Explorer and press the bookmark at the top of the analysis sheet.</p><a class="btn btn-small" href="#/explorer">Go to the Earth Explorer</a></div></li>`;
    $("#history-list").innerHTML = h.length ? h.map((e, i) => logItem(e, i, "h")).join("") : `<li class="log-empty small"><p>Places you look at will be listed here.</p></li>`;
    $("#clear-history").hidden = !h.length;
    $$(".analyses [data-open]").forEach((b) => b.addEventListener("click", () => {
      const [k, i] = b.dataset.open.split(":"); const e = (k === "s" ? s : h)[+i];
      openInvestigation(e.v, e.sel);
    }));
    $$(".analyses [data-rm]").forEach((b) => b.addEventListener("click", () => { Logbook.remove(b.dataset.rm); toast("Removed from My Analyses."); }));
  }

  /* ---------------------------------------------------------------- learn */
  function illTrend() {
    // illustrative series: seasonal cycle + small trend + noise (clearly labelled as an illustration)
    let s = 3, pts = [];
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 96; i++) pts.push(50 + 18 * Math.sin(i / 12 * 2 * Math.PI) + i * .18 + (r() - .5) * 10);
    const X = (i) => 20 + i * 5.6, Y = (v) => 150 - v * 1.6;
    const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const jans = pts.map((v, i) => i % 12 === 0 ? `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="#7FBF86"/>` : "").join("");
    return `<figure class="ill"><svg viewBox="0 0 560 160" role="img" aria-label="Illustration: a seasonal series with a slow upward trend; January values highlighted">
      <path d="${line}" fill="none" stroke="#7cc6d6" stroke-width="1.8" opacity=".7"/>
      <path d="M20 ${Y(50 - 0)} L${X(95)} ${Y(50 + 95 * .18)}" stroke="#7FBF86" stroke-width="3" stroke-dasharray="7 5"/>${jans}</svg>
      <figcaption class="mono">Illustration, not real data · pink dots: every January · dashed: the slow trend under the seasons</figcaption></figure>`;
  }
  function illCI(cross) {
    const lo = cross ? 140 : 250, hi = cross ? 330 : 380, mid = (lo + hi) / 2;
    return `<svg viewBox="0 0 420 70" class="ci-mini" role="img" aria-label="${cross ? "A range that crosses zero" : "A range entirely above zero"}">
      <line x1="10" x2="410" y1="38" y2="38" stroke="#46626a"/><line x1="210" x2="210" y1="14" y2="60" stroke="#eef3ec" stroke-dasharray="3 3"/>
      <text x="210" y="10" text-anchor="middle" class="ci-t">no change</text>
      <rect x="${lo}" y="30" width="${hi - lo}" height="16" rx="8" fill="${cross ? "rgba(199,122,0,.2)" : "rgba(10,154,122,.2)"}" stroke="${cross ? "#c77a00" : "#0a9a7a"}"/>
      <circle cx="${mid}" cy="38" r="6.5" fill="${cross ? "#c77a00" : "#0a9a7a"}" stroke="#fff" stroke-width="2"/></svg>`;
  }
  async function learn() {
    if ($("#learn-content").dataset.built) return;
    $("#learn-content").dataset.built = "1";
    const vars = state.meta.variables;
    const fams = ["confirmed", "tiny", "possible", "none", "insufficient"];
    const famText = {
      confirmed: "The trend passed the test after correcting for testing many places (q below 0.05). On the map: strong colour.",
      tiny: "Detectable, but smaller than the change that matters for this measurement. On the map: grey-green.",
      possible: "Significant on its own, but not after the correction. Worth watching, not a finding. On the map: pale colour.",
      none: "No steady trend can be separated from the natural ups and downs. Not proof of “no change”. On the map: light grey.",
      insufficient: "Too many gaps (clouds, missing months) to test honestly. On the map: dashed outline.",
    };
    $("#learn-content").innerHTML = `
      <section id="l-vars"><p class="eyebrow mono">01</p><h2>The measurements</h2>
        <p class="lede">TerraPulse works with five measurements. Four come from NASA satellites, one from a thermometer on the ground that we use to check the satellites.</p>
        <dl class="var-defs">${vars.map((v) => `<div style="--neg:${v.neg};--pos:${v.pos}"><dt>${glyph(v.id)}<span><b>${esc(v.label)}</b><small class="mono">${esc(v.source)}</small></span></dt>
          <dd><p>${esc(v.definition)}</p><p class="mono var-meta">${esc(v.units)} · ${esc(v.frequency)} · ${v.gridded ? "map + regions" : "region averages"}
          · <span class="pair"><i style="background:${v.neg}"></i>${esc(v.neg_word)} <i style="background:${v.pos}"></i>${esc(v.pos_word)}</span></p></dd></div>`).join("")}</dl>
      </section>
      <section id="l-trend"><p class="eyebrow mono">02</p><h2>Trend or noise?</h2>
        <p class="lede">Most Earth measurements swing up and down every year. A trend is the slow drift underneath those swings.</p>
        ${illTrend()}
        <div class="cols"><p><b>Compare like with like.</b> Summer is always hotter than winter, so comparing July with January says nothing about change. TerraPulse uses the <em>seasonal</em> Mann-Kendall test: each January is compared only with other Januaries, each February with other Februaries, and so on.</p>
        <p><b>Count rises and falls.</b> For every pair of years, the test asks one question: did it go up or down? Many more ups than downs, consistently, is evidence of a rising trend. One extreme year can’t dominate.</p>
        <p><b>Measure the speed.</b> Sen’s slope takes the middle of all those pairwise rates, so the “how fast” is as robust as the “is there a trend”.</p></div>
      </section>
      <section id="l-sig"><p class="eyebrow mono">03</p><h2>What “significant” means</h2>
        <p class="lede">Significant means: <b>this pattern would be very unlikely if there were no trend</b>. It does not mean big, important, or explained.</p>
        <div class="cols">
          <p><b>p-value.</b> Imagine there were no trend. The p-value is the chance of a pattern at least this strong turning up anyway. Below 0.05 (5%), we say chance alone is a poor explanation.</p>
          <p><b>q-value.</b> TerraPulse tests many places at once. Test 117 map cells and about 6 would look “significant” purely by luck. The q-value corrects for that (Benjamini-Hochberg), and it’s the number our verdicts use.</p>
          <p><b>Not significant ≠ no change.</b> It means this record can’t separate a trend from the noise. TerraPulse tells you the smallest trend the record could have caught, and how many years it would take to confirm the one it sees.</p>
        </div>
      </section>
      <section id="l-range"><p class="eyebrow mono">04</p><h2>The 95% range</h2>
        <p class="lede">Every rate comes with a range: where the true rate most likely lies.</p>
        <div class="ci-pair"><figure>${illCI(false)}<figcaption>Entirely on one side of “no change”: the direction is clear.</figcaption></figure>
          <figure>${illCI(true)}<figcaption>Crossing “no change”: the data can’t rule out zero, or even the opposite direction.</figcaption></figure></div>
      </section>
      <section id="l-verdicts"><p class="eyebrow mono">05</p><h2>The five verdicts</h2>
        <ul class="verdict-list">${fams.map((f) => `<li>${badgeHTML({ confirmed: "significant_increase", tiny: "significant_but_small", possible: "possible_increase", none: "no_significant_trend", insufficient: "insufficient_data" }[f])}<p>${famText[f]}</p></li>`).join("")}</ul>
      </section>
      <section id="l-pipeline"><p class="eyebrow mono">06</p><h2>The pipeline</h2>
        <ol class="pipe">
          <li><b>Retrieve</b><p>Monthly NASA products: MODIS vegetation and land temperature grids (AppEEARS), GPM IMERG rainfall and OMI NO₂ area averages (Giovanni), plus the NOAA Alexandria station.</p></li>
          <li><b>Prepare</b><p>Fill values, scale factors and units are handled; impossible values and spikes are removed with a check that ignores the seasons and the slow trend. Gaps stay empty.</p></li>
          <li><b>Detect &amp; measure</b><p>Seasonal Mann-Kendall with the Hirsch-Slack correction, Sen’s slope with a 95% range, false-discovery correction, and a check for sudden jumps.</p></li>
          <li><b>Visualize</b><p>Map verdicts, time series, plain-language verdicts and an AI explainer that only sees the computed numbers.</p></li>
        </ol>
      </section>
      <section id="l-trust"><p class="eyebrow mono">07</p><h2>How we know it’s right</h2>
        <div id="learn-trust"><span class="pulse-loader"></span></div>
        <div class="limits"><h3>Honest limits</h3><p>A trend describes what happened in this record. TerraPulse does not test causes or predict the future. Model and satellite measurements are not perfect; for example, land temperature stops at 2021 because the Terra satellite’s orbit drift began to fake a cooling trend.</p></div>
      </section>
      <section id="l-glossary"><p class="eyebrow mono">08</p><h2>Glossary</h2>
        <dl class="glossary">${Object.entries(Guide.TERMS).map(([k, d]) => `<div><dt>${esc(k)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>
      </section>`;
    const t = await trust(vars[0].id);
    const v = t && t.validation;
    $("#learn-trust").innerHTML = v ? (() => {
      const ak = v.answer_key.ndvi_pixels, fa = v.monte_carlo.false_alarm_rate["phi=0.5"];
      return `<div class="trust-stats">
        <div><b>${ak.found_correctly}<small>/${ak.planted_trend_pixels}</small></b><span>planted trends found in simulated data with known answers</span></div>
        <div><b>${ak.false_alarms}<small>/${ak.no_trend_pixels}</small></b><span>false alarms in cells with no planted trend</span></div>
        <div><b>${fmt(fa["TerraPulse (Hirsch-Slack, gap-tolerant)"] * 100, 2, false)}%</b><span>false alarms on ${v.n_simulations} trend-free series (target 5%), vs ${fmt(fa["seasonal MK (no correction)"] * 100, 2, false)}% for an uncorrected test</span></div></div>
        <img src="/figures/step4_validation.png" alt="Bar charts: false-alarm rate of four trend tests at three levels of autocorrelation, and their power to find a small real trend.">`;
    })() : `<p>Validation results are not available in this build.</p>`;
  }

  /* ---------------------------------------------------------------- settings */
  function settings() {
    const f = $("#settings-form");
    ["guide", "nudges", "reduceMotion", "sidebarCollapsed"].forEach((k) => (f.elements[k].checked = !!Prefs.get(k)));
    ["mapMode", "base", "lang"].forEach((k) => $$(`#settings-form input[name="${k}"]`).forEach((i) => (i.checked = i.value === Prefs.get(k))));
    const m = state.meta;
    $("#about-list").innerHTML = `
      <div><dt>Data</dt><dd>${m.dummy ? "Demonstration (simulated) data" : "Real NASA and NOAA data"}</dd></div>
      <div><dt>Measurements</dt><dd>${m.variables.length}: ${m.variables.map((v) => esc(varShort(v))).join(", ")}</dd></div>
      <div><dt>Preset regions</dt><dd>${m.regions.length}</dd></div>
      <div><dt>AI explainer</dt><dd>Free OpenRouter models, with a template answer if no key is set (see README)</dd></div>
      <div><dt>Interface</dt><dd>TerraPulse 2 · “Dawn Line” design</dd></div>`;
  }
  function wireSettings() {
    const f = $("#settings-form");
    f.addEventListener("change", (e) => {
      const i = e.target;
      if (!i.name) return;
      Prefs.set(i.name, i.type === "checkbox" ? i.checked : i.value);
      if (i.name === "mapMode") state.mode = i.value;
      toast("Saved.");
    });
    $("#replay-tour").addEventListener("click", () => { Prefs.set("guide", true); Prefs.set("welcomed", false); settings(); Guide.startTour(); });
    $("#clear-all").addEventListener("click", () => { Logbook.clearAll(); toast("Saved analyses and history deleted."); });
    $("#clear-history").addEventListener("click", () => { Logbook.clearHistory(); });
  }
  wireSettings();

  Bus.on("logbook", () => {
    const n = Logbook.saved().length;
    $("#sb-count").hidden = !n; $("#sb-count").textContent = n;
    if (document.body.dataset.route === "analyses") analyses();
    if (document.body.dataset.route === "home") renderRecent();
  });

  return { home, analyses, learn, settings, trust };
})();
