"use strict";

const Analysis = (() => {
  const TABS = ["overview", "trend", "evidence", "data", "science"];
  let current = "overview", trustHTML = "";

  function sheetState(s) {
    const el = $("#sheet");
    if (s) { el.dataset.state = s; document.body.dataset.sheet = s; }
    return el.dataset.state;
  }
  function openSheet() { if (["closed", "peek"].includes(sheetState())) sheetState("open"); Explorer.invalidate(); }
  function closeSheet() { sheetState("closed"); if (location.hash === "#/analysis") location.hash = "#/explorer"; Explorer.invalidate(); }
  function expand(on) {
    sheetState(on ? "expanded" : "open");
    $("#expand").setAttribute("aria-pressed", on);
    $("#expand").title = on ? "Back to the map" : "Expand the analysis workspace";
    if (on && current === "overview") tab("trend");
    setTimeout(() => { if (window.Plotly && state.result && !$("#pane-trend").hidden) drawChart(); }, 380);
    Explorer.invalidate();
  }

  function tab(name, focus) {
    current = name;
    TABS.forEach((t) => {
      const on = t === name;
      const b = $(`#tab-${t}`);
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
      $(`#pane-${t}`).hidden = !on;
    });
    if (focus) $(`#tab-${name}`).focus();
    if (name === "trend" && state.result) setTimeout(drawChart, 0);
    $("#sheet-body").scrollTop = 0;
    Bus.emit("tab", name);
  }

  function loading(sel) {
    openSheet();
    $("#sheet").classList.add("is-loading");
    $("#kind").textContent = { region: "Preset region", box: "Your drawn box", pixel: "Single grid cell" }[sel.kind] || "";
    if (!state.result) $("#pane-overview").innerHTML = `<div class="sheet-loading">${PULSE_SVG}<p>Asking the pipeline…</p></div>`;
  }
  function error(msg) {
    $("#sheet").classList.remove("is-loading");
    openSheet();
    state.result = null;
    $("#sheet-place").textContent = "";
    $("#pane-overview").innerHTML = `<div class="nores"><p class="eyebrow mono">No result here</p><h2>We couldn’t analyse this spot.</h2><p>${esc(msg)}</p>
      <p>Try a dashed region outline, or draw a box over the coloured cells.</p></div>`;
    ["evidence", "data", "science"].forEach((t) => ($(`#pane-${t}`).innerHTML = ""));
    if (window.Plotly) Plotly.purge("chart");
    $("#chart-note").textContent = ""; $("#trend-facts").innerHTML = "";
    tab("overview");
    Bus.emit("noresult", msg);
  }

  function render() {
    const r = state.result, sel = state.sel, vs = varById(r.variable);
    $("#sheet").classList.remove("is-loading");
    openSheet();
    $("#sheet-place").textContent = r.title;
    $("#kind").textContent = { region: "Preset region", box: "Your drawn box", pixel: "Single grid cell" }[r.kind] || "";
    const saved = Logbook.isSaved(keyOf(r.variable, sel));
    $("#save-analysis").setAttribute("aria-pressed", saved);
    $("#save-analysis").title = saved ? "Saved in My Analyses (click to remove)" : "Save to My Analyses";
    renderOverview(r, sel, vs);
    renderTrendFacts(r);
    renderEvidence(r, vs);
    renderData(r, vs);
    renderScience(r);
    if (current === "trend" || sheetState() === "expanded") drawChart();
    if (current !== "overview") tab(current);
  }

  const u = (r) => SHORT_UNITS(r.units);
  function subText(r) {
    const cp = r.change_point && r.change_point.significant ? r.change_point : null;
    let sub = r.verdict_text;
    if (cp) {
      sub += ` A sudden ${cp.shift < 0 ? "drop" : "jump"} of ${fmt(cp.shift)} ${u(r)} happened around ${cp.date}; the steady trend without it is ${fmt(cp.slope_excluding_jump * 10)} ${u(r)} per decade.`;
      if (cp.recent) sub += ` It started only ${fmt(cp.years_after, 2, false)} years before the end of the record, so it may be a temporary episode (like a drought) rather than a lasting shift.`;
    }
    return sub;
  }
  function interpretation(r) {
    const f = verdictFamily(r.verdict);
    return {
      confirmed: "The change is steady enough, and large enough compared with normal year-to-year swings, that chance alone is a very unlikely explanation. This describes what happened in this record; it doesn’t tell us why.",
      tiny: "The test can see the change, but it is smaller than the amount that matters for this measurement. Significant is not the same as important.",
      possible: "The data lean in one direction, but once we account for testing many places at once, the evidence isn’t strong enough to call it a trend. Worth watching, not a finding yet.",
      none: "The ups and downs in this record are too large to separate a steady trend from natural variation. That does not prove nothing changed: a longer record, or a bigger change, might be detectable.",
      insufficient: "There are too few valid observations here to test for a trend honestly.",
    }[f];
  }

  function spark(r, col) {
    const ys = r.annual.value, xs = r.annual.year, tr = r.lines.trend;
    const vals = ys.concat(tr).filter((v) => v != null && isFinite(v));
    if (vals.length < 2) return "";
    const lo = Math.min(...vals), hi = Math.max(...vals), W = 320, H = 86, pad = 6;
    const X = (i) => pad + (W - 2 * pad) * i / (xs.length - 1), Y = (v) => H - pad - (H - 2 * pad) * (v - lo) / ((hi - lo) || 1);
    let d = "", started = false;
    ys.forEach((v, i) => { if (v == null) { started = false; return; } d += `${started ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; started = true; });
    let t = "", s2 = false;
    const jk = r.lines.jump_year ? r.annual.year.findIndex((y) => y + .5 >= r.lines.jump_year) : -1;
    tr.forEach((v, i) => { if (v == null || i === jk) { s2 = false; if (i !== jk) return; } t += `${s2 ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; s2 = true; });
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${d}" fill="none" stroke="#9ab3b0" stroke-width="1.6"/>
      <path d="${t}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"/></svg>
      <div class="spark-x mono"><span>${xs[0]}</span><span>yearly averages · trend</span><span>${xs[xs.length - 1]}</span></div>`;
  }

  function renderOverview(r, sel, vs) {
    const [lo, hi] = r.slope_ci95 || [null, null];
    const cp = r.change_point && r.change_point.significant ? r.change_point : null;
    const col = trendColor(r);
    const term = r.variable_label.replace(/ \(.*\)/, "").toLowerCase();
    $("#pane-overview").innerHTML = `
      <p class="eyebrow mono">What did we discover?</p>
      <h2 class="verdict fresh" id="verdict-headline">${esc(headline(r, sel))}</h2>
      ${badgeHTML(r.verdict)}
      <p class="verdict-sub">${esc(subText(r))}</p>
      <div class="kpis">
        <div class="kpi" data-explain="rate"><span class="mono">Rate of change${cp ? ", jump included" : ""}</span>
          <b>${fmt(r.slope_per_decade)}</b><small>${esc(u(r))} per decade</small>
          <em>95% range ${fmt(lo * 10)} to ${fmt(hi * 10)}</em></div>
        <div class="kpi"><span class="mono">Total change</span>
          <b>${fmt(r.total_change)}</b><small>${esc(u(r))}</small>
          <em>over ${Math.round(r.record_years)} years${r.percent_change != null ? `, ${fmt(r.percent_change, 2)}%` : ""}</em></div>
        <div class="kpi" data-explain="evidence"><span class="mono">Evidence</span>
          <b class="ev-word f-${verdictFamily(r.verdict)}">${esc(evidenceWords(r))}</b>
          <em>q ${r.q < 0.001 ? "< 0.001" : "= " + fmt(r.q, 2, false)} (below 0.05 = confirmed)</em></div>
      </div>
      <div class="ov-spark">${spark(r, col)}</div>
      <div class="plain"><p class="mono">In plain words</p><p>${esc(interpretation(r))}</p></div>
      ${vs && vs.definition ? `<details class="define" open><summary>What is ${esc(term)}?</summary><p>${esc(vs.definition)}</p></details>` : ""}
      <div class="next">
        <button data-go="trend">See the full trend <span>→</span></button>
        <button data-go="evidence">How sure are we? <span>→</span></button>
        <button data-go="ask">Ask about this result <span>→</span></button>
      </div>`;
    $$("#pane-overview .next button").forEach((b) => b.addEventListener("click", () => (b.dataset.go === "ask" ? Chat.openDrawer() : tab(b.dataset.go, true))));
  }

  function renderTrendFacts(r) {
    const cp = r.change_point && r.change_point.significant ? r.change_point : null;
    const [lo, hi] = r.slope_ci95 || [null, null];
    $("#trend-facts").innerHTML = `<dl class="facts">
      <div><dt>Rate of change${cp ? ", jump included" : ""}</dt><dd>${fmt(r.slope_per_decade)} ${esc(u(r))} per decade<small>95% range ${fmt(lo * 10)} to ${fmt(hi * 10)}</small></dd></div>
      <div><dt>Total change</dt><dd>${fmt(r.total_change)} ${esc(u(r))}<small>over ${Math.round(r.record_years)} years${cp ? ", jump included" : ""}${r.percent_change != null ? `, ${fmt(r.percent_change, 2)}%` : ""}</small></dd></div>
      <div><dt>Size vs. normal swings</dt><dd>${r.signal_to_noise != null ? fmt(r.signal_to_noise, 2, false) + "×" : "–"}<small>total change ÷ typical year-to-year swing</small></dd></div>
      <div><dt>Direction</dt><dd>${r.slope_per_year > 0 ? "Rising" : r.slope_per_year < 0 ? "Falling" : "Flat"}<small>Sen’s slope through the seasonal data</small></dd></div>
      ${cp ? `<div class="wide jump"><dt>Sudden ${cp.shift < 0 ? "drop" : "jump"}</dt><dd>${esc(cp.date)}: ${fmt(cp.shift)} ${esc(u(r))}<small>steady trend without the jump: ${fmt(cp.slope_excluding_jump * 10)} ${esc(u(r))} per decade${cp.recent ? ". Recent: it may be a temporary episode" : ""}</small></dd></div>` : ""}
    </dl>`;
  }

  function ciDiagram(r, vs) {
    const [lo, hi] = (r.slope_ci95 || [null, null]).map((x) => x == null ? null : x * 10);
    const s = r.slope_per_decade;
    if (lo == null || hi == null || s == null) return "";
    const ext = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(s)) * 1.35 || 1;
    const X = (v) => 20 + 360 * (v + ext) / (2 * ext);
    const col = trendColor(r);
    const crosses = lo <= 0 && hi >= 0;
    return `<figure class="ci-fig">
      <svg viewBox="0 0 400 96" role="img" aria-label="95% range of the rate, from ${fmt(lo)} to ${fmt(hi)} ${u(r)} per decade, best estimate ${fmt(s)}">
        <line x1="20" x2="380" y1="52" y2="52" stroke="#46626a" stroke-width="1.5"/>
        <line x1="${X(0)}" x2="${X(0)}" y1="22" y2="78" stroke="#eef3ec" stroke-width="1.5" stroke-dasharray="3 3"/>
        <text x="${X(0)}" y="16" text-anchor="middle" class="ci-t">no change</text>
        <rect x="${X(lo)}" y="44" width="${Math.max(2, X(hi) - X(lo))}" height="16" rx="8" fill="${hexA(col, .25)}" stroke="${col}" stroke-width="1.5"/>
        <circle cx="${X(s)}" cy="52" r="7" fill="${col}" stroke="#fff" stroke-width="2"/>
        ${X(hi) - X(lo) < 70
          ? `<text x="${X(lo) - 6}" y="84" text-anchor="end" class="ci-n">${fmt(lo)}</text><text x="${X(hi) + 6}" y="84" class="ci-n">${fmt(hi)}</text>`
          : `<text x="${X(lo)}" y="84" text-anchor="middle" class="ci-n">${fmt(lo)}</text><text x="${X(hi)}" y="84" text-anchor="middle" class="ci-n">${fmt(hi)}</text>`}
        <text x="380" y="30" text-anchor="end" class="ci-t">${vs ? esc(vs.pos_word) : "more"} →</text>
        <text x="20" y="30" class="ci-t">← ${vs ? esc(vs.neg_word) : "less"}</text>
      </svg>
      <figcaption>Best estimate <b>${fmt(s)} ${esc(u(r))} per decade</b>. The bar is the 95% range: where the true rate most likely lies.
        ${crosses ? "The range crosses “no change”, so the data can’t rule out zero." : "The whole range sits on one side of “no change”."}</figcaption>
    </figure>`;
  }

  function renderEvidence(r, vs) {
    const f = verdictFamily(r.verdict);
    const levels = [["weak", "Weak"], ["moderate", "Moderate"], ["strong", "Strong"]];
    const lvl = f === "confirmed" ? (r.q < 0.01 ? 2 : 1) : f === "tiny" ? 1 : f === "possible" ? 0 : -1;
    const det = r.min_detectable_slope != null ? fmt(r.min_detectable_slope * 10, 2, false) : null;
    const ytd = r.years_to_detect != null && isFinite(r.years_to_detect) ? Math.round(r.years_to_detect) : null;
    $("#pane-evidence").innerHTML = `
      <p class="eyebrow mono">Evidence &amp; confidence</p>
      <h3 class="pane-h">${f === "confirmed" ? "How strong is the evidence?" : "Why isn’t this a confirmed trend?"}</h3>
      ${badgeHTML(r.verdict)}
      <ol class="meter" aria-label="Evidence strength: ${esc(evidenceWords(r))}">
        ${levels.map(([k, l], i) => `<li class="${i <= lvl ? "on" : ""} ${i === lvl ? "cur" : ""}"><i></i><span>${l}</span></li>`).join("")}
      </ol>
      <p class="meter-note">Evidence for a trend: <b>${esc(evidenceWords(r))}</b>${lvl < 0 ? " (none of the bars light up)" : ""}</p>
      ${f === "tiny" ? `<p class="callout">Statistically detectable, but below the smallest change that matters for this measurement.</p>` : ""}
      ${ciDiagram(r, vs)}
      <dl class="facts">
        <div data-explain="p"><dt>p-value (seasonal Mann-Kendall)</dt><dd>p ${fmtP(r.p)}<small>chance of a pattern at least this strong if there were no trend</small></dd></div>
        <div data-explain="q"><dt>q-value (after correction)</dt><dd>q ${r.q < 0.001 ? "< 0.001" : "= " + fmt(r.q, 2, false)}<small>${esc(r.multiple_testing || "")}</small></dd></div>
        <div><dt>Threshold</dt><dd>0.05<small>below it, we call a trend confirmed</small></dd></div>
        <div><dt>Size vs. normal swings</dt><dd>${r.signal_to_noise != null ? fmt(r.signal_to_noise, 2, false) + "×" : "–"}<small>total change ÷ typical year-to-year swing</small></dd></div>
      </dl>
      <div class="plain"><p class="mono">About uncertainty</p>
        <p>${f === "confirmed" || f === "tiny"
          ? "A confirmed trend means chance alone is a very unlikely explanation. It does not say what caused the change, and it does not predict the future."
          : "“Not confirmed” is not the same as “no change”. It means this record can’t separate a steady trend from natural ups and downs."}</p>
        ${det ? `<p>With this record, a trend larger than about <b>${det} ${esc(u(r))} per decade</b> would very likely have been detected.</p>` : ""}
        ${ytd != null ? `<p>${f === "confirmed" ? "A trend of this size needs" : "At this rate, confirming it would need"} about <b>${ytd} years</b> of data; this record has ${Math.round(r.record_years)}.</p>` : ""}
      </div>`;
  }

  function availabilityStrip(r) {
    const v = r.series.value, t = r.series.time;
    if (!v || !v.length) return "";
    const n = v.length, W = 400;
    const w = W / n;
    const bars = v.map((x, i) => `<rect x="${(i * w).toFixed(2)}" y="${x == null ? 10 : 2}" width="${Math.max(.6, w - .3).toFixed(2)}" height="${x == null ? 6 : 22}" fill="${x == null ? "#e4c6c6" : "#7cc6d6"}" opacity="${x == null ? 1 : .75}"/>`).join("");
    const valid = v.filter((x) => x != null).length;
    return `<figure class="avail"><svg viewBox="0 0 ${W} 26" preserveAspectRatio="none" role="img" aria-label="${valid} of ${n} time steps have a value">${bars}</svg>
      <figcaption class="mono"><span>${esc(t[0].slice(0, 7))}</span><span>${valid} of ${n} steps have data</span><span>${esc(t[n - 1].slice(0, 7))}</span></figcaption></figure>`;
  }

  function renderData(r, vs) {
    const cl = r.cleaning || {};
    const removed = cl.raw_values ? (cl.removed_fill_or_missing + cl.removed_out_of_range + cl.removed_spikes) / cl.raw_values : null;
    const stepWord = r.frequency === "monthly" ? "months" : r.frequency === "quarterly" ? "seasons" : "years";
    const box = r.box || (state.meta.regions.find((x) => x.id === r.region) || {}).box;
    $("#pane-data").innerHTML = `
      <p class="eyebrow mono">Data information</p>
      <h3 class="pane-h">${esc(r.variable_label)}</h3>
      <p class="src mono">${esc(r.source)}</p>
      ${availabilityStrip(r)}
      <dl class="facts">
        <div><dt>Time coverage</dt><dd>${esc(r.series.time[0].slice(0, 7))} → ${esc(r.series.time[r.series.time.length - 1].slice(0, 7))}<small>${fmt(r.record_years, 3, false)} years, ${esc(r.frequency)}</small></dd></div>
        <div><dt>Observations used</dt><dd>${r.n_valid} ${stepWord}<small>valid time steps in the test</small></dd></div>
        <div><dt>Area</dt><dd>${r.pixels_used} grid cell${r.pixels_used > 1 ? "s" : ""}<small>${box ? `${box[0]}–${box[1]}°N, ${box[2]}–${box[3]}°E` : esc(r.title)}</small></dd></div>
        <div><dt>Units</dt><dd>${esc(r.units)}<small>${r.kind === "region" ? "area average" : r.kind === "box" ? "average over your box (weighted by latitude)" : "one cell"}</small></dd></div>
      </dl>
      ${cl.raw_values ? `<div class="plain"><p class="mono">Cleaning</p><p>Of ${cl.raw_values.toLocaleString()} raw values for this measurement,
        ${(cl.removed_fill_or_missing || 0).toLocaleString()} were missing or marked as cloud, ${cl.removed_out_of_range || 0} were physically impossible and
        ${(cl.removed_spikes || 0).toLocaleString()} were spikes${removed != null ? ` (${fmt(removed * 100, 2, false)}% removed in total)` : ""}.
        Gaps are left empty, never filled with invented values.</p>
        ${cl.cutoff ? `<p><b>The record stops at ${esc(cl.cutoff)}.</b> ${esc(cl.cutoff_reason)}</p>` : ""}</div>` : ""}
      ${vs && vs.definition ? `<div class="plain"><p class="mono">What it measures</p><p>${esc(vs.definition)}</p></div>` : ""}
      <p class="fine">${r.dummy ? "Demonstration data: simulated with known trends to test the pipeline." : "Real data, downloaded from NASA and NOAA archives."}</p>`;
  }

  function renderScience(r) {
    const lt = r.linear_ttest, cp = r.change_point;
    const [lo, hi] = r.slope_ci95 || [null, null];
    const row = (k, v, note = "") => `<tr><th scope="row">${k}</th><td class="mono">${v}</td><td>${note}</td></tr>`;
    $("#pane-science").innerHTML = `
      <p class="eyebrow mono">Scientific details</p>
      <h3 class="pane-h">${esc(r.method || "Seasonal Mann-Kendall")}</h3>
      <table class="stats">
        <tbody>
        ${row("S", fmt(r.S, 4), "Mann-Kendall score: rises minus falls, comparing each month with the same month in other years")}
        ${row("z", fmt(r.z, 3), "S standardised, after the Hirsch-Slack correction for related months")}
        ${row("p", fmtP(r.p).replace("= ", ""), "two-sided")}
        ${row("q", r.q < 0.001 ? "< 0.001" : fmt(r.q, 2, false), esc(r.multiple_testing || ""))}
        ${row("Sen’s slope", `${fmt(r.slope_per_year, 3)} / yr`, `95% range ${fmt(lo, 3)} to ${fmt(hi, 3)} per year (Gilbert 1987)`)}
        ${row("Lag-1 autocorrelation", fmt(r.lag1_autocorr, 2, false), "how alike neighbouring time steps are")}
        ${row("Year-to-year noise (σ)", fmt(r.noise_sigma_annual, 3, false), esc(u(r)))}
        ${row("Smallest detectable trend", r.min_detectable_slope != null ? `${fmt(r.min_detectable_slope, 3, false)} / yr` : "–", "Weatherhead et al. 1998")}
        ${row("Years to detect this trend", r.years_to_detect != null && isFinite(r.years_to_detect) ? fmt(r.years_to_detect, 3, false) : "–", "")}
        </tbody>
      </table>
      ${lt ? `<div class="plain"><p class="mono">Classic check: straight-line fit and t-test</p><p>${fmt(lt.slope_per_year * 10)} ${esc(u(r))} per decade; p ${fmtP(lt.p_adjusted)} after allowing for neighbouring months being alike
        (p ${fmtP(lt.p_naive)} if we wrongly treat every month as independent; effective sample ${fmt(lt.n_effective, 3, false)} of ${lt.n}).
        ${(lt.p_adjusted < 0.05) === r.verdict.startsWith("significant_") ? "Agrees with the main test." : "Differs from the main test; the seasonal Mann-Kendall result is more robust for skewed, seasonal data."}</p></div>` : ""}
      ${cp ? `<div class="plain"><p class="mono">Sudden-jump check (trend + jump vs. trend only, BIC)</p><p>Best jump date ${esc(cp.date)}, size ${fmt(cp.shift)} ${esc(u(r))}, ΔBIC ${fmt(cp.delta_bic, 3)}.
        ${cp.significant ? `Kept: the model with a jump explains the data clearly better.${cp.recent ? " It began less than 4 years before the record ends, so it may be temporary." : ""}` : "Not kept: a jump doesn’t explain the data clearly better than a steady trend."}</p></div>` : ""}
      <details class="trust" id="trust"><summary>How do we know this is right?</summary><div id="trust-body">${trustHTML}</div></details>`;
  }

  async function loadTrust() {
    let t;
    try { t = await api(`/api/trust/${state.v}`); } catch (e) { return; }
    const c = t.cleaning || {}, v = t.validation;
    const pct = (n) => c.raw_values ? `${fmt((100 * n) / c.raw_values, 2, false)}%` : "";
    let html = `<p><b>Cleaning ${esc(Explorer.varSpec().label.toLowerCase())}.</b> Of ${c.raw_values?.toLocaleString()} raw values,
      ${c.removed_fill_or_missing?.toLocaleString()} (${pct(c.removed_fill_or_missing)}) were missing or marked as cloud and were removed;
      ${c.removed_out_of_range} were physically impossible; ${c.removed_spikes} were spikes, found with a check that ignores the
      seasonal cycle and the slow trend so real change is never deleted. Gaps are left empty, never filled with invented values,
      because filled gaps make trends look more certain than they are. Analysed at ${esc(c.frequency)} resolution.</p>`;
    if (c.cutoff) html += `<p><b>Record stops at ${esc(c.cutoff)}.</b> ${esc(c.cutoff_reason)} (${c.removed_after_cutoff?.toLocaleString()} later values set aside.)</p>`;
    if (v) {
      const ak = v.answer_key.ndvi_pixels, fa = v.monte_carlo.false_alarm_rate["phi=0.5"], cp = v.monte_carlo.change_point;
      html += `<p><b>Tested on data with known answers.</b> The pipeline found ${ak.found_correctly} of ${ak.planted_trend_pixels} planted trend cells
        with ${ak.false_alarms} false alarm in ${ak.no_trend_pixels} cells that had no trend, and recovered every planted rate inside its 95% range.</p>
        <p><b>False alarms.</b> On ${v.n_simulations} simulated series with no trend, TerraPulse called ${fmt(fa["TerraPulse (Hirsch-Slack, gap-tolerant)"] * 100, 2, false)}% significant
        (the target is 5%); an uncorrected seasonal test called ${fmt(fa["seasonal MK (no correction)"] * 100, 2, false)}%. Sudden jumps: ${fmt(cp.false_jump_rate_on_smooth_trend * 100, 2, false)}%
        false jumps on smooth trends.</p>
        <img src="/figures/step4_validation.png" alt="Bar charts: false-alarm rate of four trend tests at three levels of autocorrelation, and their power to find a small real trend.">`;
    }
    html += `<p><b>Methods.</b></p><ul>
      <li>Seasonal Mann-Kendall test with the Hirsch-Slack correction, rewritten to keep years that have gaps.</li>
      <li>Seasonal Sen’s slope with a 95% confidence range.</li>
      <li>Benjamini-Hochberg false discovery rate across all map cells and preset regions.</li>
      <li>Trend-plus-jump model comparison (BIC, adjusted for autocorrelation) for sudden changes.</li>
      <li>Detectability: the smallest trend each record could have caught.</li></ul>
      <p>A trend describes what happened in this record. It does not test causes or predict the future.</p>`;
    trustHTML = html;
    const tb = $("#trust-body"); if (tb) tb.innerHTML = html;
    Bus.emit("trust", t);
  }

  function trendColor(r) {
    const vs = varById(r.variable);
    if (r.verdict === "significant_but_small") return C.muted;
    if (r.verdict.startsWith("significant_") || r.verdict.startsWith("possible_")) return r.slope_per_year >= 0 ? vs.pos : vs.neg;
    return C.muted;
  }
  function seriesTraces(r, col, name, showMonthly, legend = true) {
    const yrs = r.annual.year.map((y) => `${y}-07-01`);
    const uu = SHORT_UNITS(r.units);
    const t = [];
    if (showMonthly)
      t.push({ x: r.series.time, y: r.series.value, mode: "lines", line: { width: 1, color: "rgba(169,191,189,.28)" },
               name: "Monthly value", hovertemplate: `%{y:.3g} ${uu}<extra>monthly</extra>` });
    if (r.lines.fan) {
      t.push({ x: yrs, y: r.lines.fan[0], mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      t.push({ x: yrs, y: r.lines.fan[1], mode: "lines", line: { width: 0 }, fill: "tonexty",
               fillcolor: hexA(col, .14), name: "95% range of the trend", hoverinfo: "skip", showlegend: legend });
    }
    let tx = yrs.slice(), ty = r.lines.trend.slice();
    if (r.lines.jump_year) {
      const k = r.annual.year.findIndex((y) => y + .5 >= r.lines.jump_year);
      tx.splice(k, 0, null); ty.splice(k, 0, null);
    }
    t.push({ x: tx, y: ty, mode: "lines", line: { width: 2.8, color: col }, name: `Trend, ${name}`, showlegend: legend,
             hovertemplate: `trend %{y:.3g} ${uu}<extra></extra>`, connectgaps: false });
    t.push({ x: yrs, y: r.annual.value, mode: "lines+markers", line: { width: 1.6, color: name === "this place" ? C.ink2 : col },
             marker: { size: 6, color: name === "this place" ? C.ink2 : col, line: { color: "#fff", width: 1.5 } },
             name: legend ? `Yearly average, ${name}` : name, hovertemplate: `%{y:.3g} ${uu}<extra>${name}</extra>` });
    return t;
  }
  function drawChart() {
    const r = state.result, c = state.cmp;
    if (!r || !window.Plotly || $("#pane-trend").hidden) return;
    const comparing = !!c;
    const shapes = [], ann = [];
    const nice = (p) => cap(p.replace(/^the /, ""));
    const nameA = comparing ? nice(placeOf(state.sel, r)) : "this place";
    let traces = comparing ? seriesTraces(r, C.nile, nameA, false, false) : seriesTraces(r, trendColor(r), nameA, true);
    if (comparing) {
      traces = traces.concat(seriesTraces(c, C.ochre, nice(c._place), false, false));
      const last = (res) => res.lines.trend[res.lines.trend.length - 1];
      const aHigher = last(r) >= last(c);
      for (const [res, col, nm, high] of [[r, C.nile, nameA, aHigher], [c, C.ochre, nice(c._place), !aHigher]]) {
        const i = res.annual.year.length - 1;
        ann.push({ x: `${res.annual.year[i]}-07-01`, y: last(res), text: nm, showarrow: false, xanchor: "right",
                   yanchor: high ? "bottom" : "top", yshift: high ? 8 : -8, font: { size: 11.5, color: col } });
      }
    }
    for (const [res, col] of comparing ? [[r, C.nile], [c, C.ochre]] : [[r, C.ink]]) {
      if (res.lines.jump_year) {
        const jx = `${Math.floor(res.lines.jump_year)}-${String(Math.round((res.lines.jump_year % 1) * 12) + 1).padStart(2, "0")}-01`;
        shapes.push({ type: "line", x0: jx, x1: jx, yref: "paper", y0: 0, y1: 1, line: { color: col, width: 1.2, dash: "dash" } });
        ann.push({ x: jx, y: 1, yref: "paper", text: "sudden jump", showarrow: false, xanchor: "left", yanchor: "top",
                   font: { size: 11, color: col }, xshift: 4 });
      }
    }
    Plotly.react("chart", traces, {
      margin: { l: 50, r: 10, t: 10, b: 30 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Readex Pro, system-ui, sans-serif", size: 12, color: C.ink2 },
      xaxis: { showgrid: false, linecolor: C.rule, ticks: "outside", tickcolor: C.rule },
      yaxis: { gridcolor: "#2a4148", zeroline: false, title: { text: SHORT_UNITS(r.units), font: { size: 12 } } },
      showlegend: comparing, legend: { orientation: "h", y: -0.16, font: { size: 11.5 } },
      hovermode: "x unified", hoverlabel: { font: { family: "Readex Pro" } }, shapes, annotations: ann,
    }, { displayModeBar: false, responsive: true });
    $("#chart-title").textContent = comparing ? "Side by side" : "Over time";
    $("#chart-note").textContent = comparing
      ? "Yearly averages and trend lines for both places. Same variable, same scale."
      : "Thin line: monthly values after cleaning. Dots: yearly averages. Band: 95% range of the trend.";
  }

  function wire() {
    TABS.forEach((t) => $(`#tab-${t}`).addEventListener("click", () => tab(t)));
    $(".tabs").addEventListener("keydown", (e) => {
      const i = TABS.indexOf(current);
      if (e.key === "ArrowRight") { e.preventDefault(); tab(TABS[(i + 1) % TABS.length], true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); tab(TABS[(i + TABS.length - 1) % TABS.length], true); }
    });
    $("#sheet-close").addEventListener("click", closeSheet);
    $("#expand").addEventListener("click", () => {
      const on = sheetState() !== "expanded";
      location.hash = on ? "#/analysis" : "#/explorer";
    });
    $("#save-analysis").addEventListener("click", () => {
      if (!state.result) return;
      const on = Logbook.toggleSave(state.result, state.sel);
      $("#save-analysis").setAttribute("aria-pressed", on);
      toast(on ? "Saved to My Analyses." : "Removed from My Analyses.");
    });
    $("#sheet-grip").addEventListener("click", () => sheetState(sheetState() === "peek" ? "open" : "peek"));
    const resizeChart = () => { if (state.result && !$("#pane-trend").hidden && window.Plotly && $("#chart").data) Plotly.Plots.resize("chart"); };
    addEventListener("resize", resizeChart);
    $("#sheet").addEventListener("transitionend", (e) => { if (e.target === $("#sheet") && (e.propertyName === "width" || e.propertyName === "transform")) { drawChart(); resizeChart(); } });
  }
  wire();

  return { render, loading, error, drawChart, loadTrust, tab, expand, sheetState, trendColor, subText, interpretation, spark };
})();
