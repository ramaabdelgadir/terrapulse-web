/* Earth Explorer: map, variable picker, regions, cells, draw-a-box, selection.
   Map logic and API calls are carried over from the original app.js. */
"use strict";

const Explorer = (() => {
  let map, imagery, labels, streets, cellLayer, regionLayer, drawnLayer, markLayer, legend = null, drawer = null;
  let cellCanvas = null;
  const SEL_COLOR = "#5cf2ff";   // selected place / drawn box: bright aqua with a dark edge, visible on every map colour   // one canvas for all grid cells: far lighter than thousands of SVG shapes
  let ready = false, pixelsCache = {};

  /* ---------------------------------------------------------------- map */
  function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 3, worldCopyJump: true, attributionControl: true }).setView([30.5, 31.0], 8);
    L.control.zoom({ position: "topright" }).addTo(map);
    imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Imagery © Esri, Maxar, Earthstar Geographics", maxZoom: 18 });
    labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, pane: "shadowPane" });
    streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 18 });
    cellLayer = L.layerGroup().addTo(map);
    regionLayer = L.layerGroup().addTo(map);
    drawnLayer = L.featureGroup().addTo(map);
    markLayer = L.layerGroup().addTo(map);
    setBase(Prefs.get("base"));
    labels.addTo(map);

    map.on(L.Draw.Event.CREATED, (e) => {
      drawnLayer.clearLayers();
      drawnLayer.addLayer(e.layer);
      stopDrawing();
      const b = e.layer.getBounds();
      state.box = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()].map((x) => +x.toFixed(3));
      select({ kind: "box", box: state.box });
    });
    map.on("draw:drawstop", () => stopDrawing());
    ready = true;
  }
  function setBase(b) {
    [imagery, streets].forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    if (b === "imagery") imagery.addTo(map);
    else if (b === "streets") streets.addTo(map);
    $("#map").dataset.base = b;
    $$('#layers-pop input[name="base"]').forEach((i) => (i.checked = i.value === b));
  }
  const varSpec = () => varById(state.v);

  /* ---------------------------------------------------------------- cells (unchanged styling logic) */
  function cellStyle(c, vs, slopeMax) {
    const sig = c.verdict.startsWith("significant_");
    const poss = c.verdict.startsWith("possible_");
    if (c.verdict === "insufficient_data") return { color: "#fff", weight: 1, dashArray: "3 3", fillOpacity: 0, opacity: .6 };
    if (c.verdict === "significant_but_small" && state.mode === "verdict")
      return { color: "#fff", weight: .4, opacity: .4, fillColor: C.tiny, fillOpacity: .3 };
    if (state.mode === "verdict") {
      if (sig || poss) {
        const col = c.verdict.endsWith("increase") ? vs.pos : vs.neg;
        return { color: "#fff", weight: .6, opacity: .7, fillColor: col, fillOpacity: sig ? .68 : .34 };
      }
      return { color: "#fff", weight: .4, opacity: .35, fillColor: C.none, fillOpacity: .14 };
    }
    const t = Math.max(-1, Math.min(1, (c.slope || 0) / (slopeMax || 1)));
    const col = mix(C.neutral, t >= 0 ? vs.pos : vs.neg, Math.abs(t));
    return { color: "#fff", weight: .5, opacity: .5, fillColor: col, fillOpacity: sig ? .78 : .42 };
  }

  async function drawCells() {
    cellLayer.clearLayers(); markLayer.clearLayers();
    const vs = varSpec();
    if (!vs.gridded) {
      if (vs.point)
        L.circleMarker(vs.point, { radius: 9, color: "#fff", weight: 2, fillColor: C.nile, fillOpacity: 1 })
          .bindTooltip("NASA POWER point: Cairo", { className: "reg", direction: "top" })
          .on("click", () => select({ kind: "region", id: "point" })).addTo(markLayer);
      drawLegend(vs, null);
      return;
    }
    const want = state.v;
    const px = pixelsCache[want] || (pixelsCache[want] = await api(`/api/pixels/${want}`));
    if (px.var !== state.v) return;
    for (const c of px.cells) {
      const b = [[c.lat - px.dlat / 2, c.lon - px.dlon / 2], [c.lat + px.dlat / 2, c.lon + px.dlon / 2]];
      cellCanvas = cellCanvas || L.canvas({ padding: 0.3 });
      const r = L.rectangle(b, Object.assign(cellStyle(c, vs, px.slope_max), { renderer: cellCanvas })).addTo(cellLayer);
      r.bindTooltip(`${fmt(c.slope * 10)} ${SHORT_UNITS(vs.units)}/decade, ${c.verdict.replaceAll("_", " ")}`, { sticky: true });
      r.on("click", () => select({ kind: "pixel", lat: c.lat, lon: c.lon }));
      if (state.mode === "rate" && c.verdict.startsWith("significant_"))
        L.circleMarker([c.lat, c.lon], { radius: 2.2, stroke: false, fillColor: "#fff", fillOpacity: .95, interactive: false, renderer: cellCanvas }).addTo(markLayer);
    }
    if (!$("#lyr-cells").checked) map.removeLayer(cellLayer);
    drawLegend(vs, px.slope_max);
  }

  function drawLegend(vs, slopeMax) {
    if (legend) legend.remove();
    legend = L.control({ position: "bottomleft" });
    legend.onAdd = () => {
      const d = L.DomUtil.create("div", "legend");
      d.setAttribute("data-explain", "legend");
      if (!vs.gridded) {
        d.innerHTML = `<b>${esc(vs.label)}</b><span>${vs.point ? "Single point from NASA POWER" : "Region averages: click a dashed outline"}</span>`;
        return d;
      }
      if (state.mode === "verdict") {
        const row = (col, op, txt) => `<div class="row"><span class="sw" style="background:${col};opacity:${op}"></span>${txt}</div>`;
        d.innerHTML = `<b>${esc(vs.label)}</b>` + row(vs.pos, .9, `Confirmed ${vs.pos_word}`) + row(vs.pos, .45, `Possible ${vs.pos_word}`)
          + row(C.none, .5, "No confirmed trend") + row(C.tiny, .55, "Real but tiny change") + row(vs.neg, .45, `Possible ${vs.neg_word}`) + row(vs.neg, .9, `Confirmed ${vs.neg_word}`)
          + `<div class="row"><span class="sw dashed"></span>Not enough data</div>`;
      } else {
        const u = SHORT_UNITS(vs.units);
        d.innerHTML = `<b>${esc(vs.label)}, change per decade</b><div class="ramp" style="background:linear-gradient(90deg,${vs.neg},${C.neutral},${vs.pos})"></div>`
          + `<div class="ends"><span>${fmt(-slopeMax * 10)}</span><span>0</span><span>${fmt(slopeMax * 10)} ${u}</span></div>`
          + `<div class="row" style="margin-top:4px"><span class="sw dotted"></span>Dot = confirmed trend</div>`;
      }
      return d;
    };
    legend.addTo(map);
  }

  function drawRegions() {
    regionLayer.clearLayers();
    const vs = varSpec();
    for (const r of state.meta.regions) {
      if (!(vs.regions_avail || []).includes(r.id)) continue;
      if (vs.gridded && r.id === "nile_delta") continue;   // the whole box = the data area
      const [la0, la1, lo0, lo1] = r.box;
      const on = state.sel && state.sel.kind === "region" && state.sel.id === r.id;
      const rect = L.rectangle([[la0, lo0], [la1, lo1]],
        { color: on ? SEL_COLOR : "#fff", weight: on ? 3.5 : 1.4, dashArray: on ? null : "5 4", fill: true, fillOpacity: on ? .08 : 0, fillColor: SEL_COLOR,
          opacity: on ? 1 : .85, className: on ? "sel-glow" : "" });
      rect.bindTooltip(cap(PLACE[r.id] || r.label), { permanent: true, direction: "top", className: "reg" + (on ? " on" : ""), offset: [0, -2] });
      rect.on("click", (e) => { L.DomEvent.stopPropagation(e); select({ kind: "region", id: r.id }); });
      rect.addTo(regionLayer);
    }
    renderRegionsList();
  }

  function renderRegionsList() {
    const vs = varSpec();
    const regs = state.meta.regions.filter((r) => (vs.regions_avail || []).includes(r.id));
    $("#regions-list").innerHTML = regs.map((r) => {
      const on = state.sel && state.sel.kind === "region" && state.sel.id === r.id;
      return `<li><button data-r="${r.id}" class="${on ? "on" : ""}"><b>${esc(cap((PLACE[r.id] || r.label).replace(/^the /, "")))}</b><small>${esc(r.label)}</small></button></li>`;
    }).join("") || `<li class="empty">This measurement has no preset regions.</li>`;
    $$("#regions-list button").forEach((b) => b.addEventListener("click", () => { closePops(); select({ kind: "region", id: b.dataset.r }); }));
  }

  /* ---------------------------------------------------------------- draw a box */
  function startDrawing() {
    if (!varSpec().gridded) { toast("Drawing works for map measurements (vegetation and land temperature)."); return; }
    if (drawer) return stopDrawing();
    // on a phone the result sheet covers the map: slide it down so there is room to draw
    if (matchMedia("(max-width: 860px)").matches && ["open", "expanded"].includes(Analysis.sheetState())) {
      if (!$("#ask-drawer").hidden) Chat.closeDrawer();
      Analysis.sheetState("peek"); invalidate();
    }
    $("#map").classList.add("drawing");        // cells stop catching the mouse while a box is drawn
    drawer = new L.Draw.Rectangle(map, { shapeOptions: { color: SEL_COLOR, weight: 3.5, fillOpacity: .1, className: "sel-glow" }, showArea: false });
    drawer.enable();
    $("#draw").classList.add("active"); $("#draw").setAttribute("aria-pressed", "true");
    $("#hint").textContent = "Drag on the map to draw a box. Press Esc to cancel.";
    Bus.emit("drawing");
  }
  function stopDrawing() {
    if (drawer) { try { drawer.disable(); } catch (e) { /* already off */ } }
    drawer = null;
    $("#map").classList.remove("drawing");
    $("#draw").classList.remove("active"); $("#draw").setAttribute("aria-pressed", "false");
    $("#hint").textContent = hintText();
  }
  const hintText = () => {
    const vs = state.v && varSpec();
    if (!vs) return "Choose a measurement to begin.";
    return vs.gridded ? "Click a dashed region outline or a cell, or draw your own box." : "Click a dashed region outline to see its trend.";
  };

  /* ---------------------------------------------------------------- selection */
  async function fetchResult(sel, v = state.v) {
    if (sel.kind === "region") return api(`/api/region/${v}/${sel.id}`);
    if (sel.kind === "box") return api("/api/analyze_box", { var: v, box: sel.box });
    return api(`/api/pixel/${v}?lat=${sel.lat}&lon=${sel.lon}`);
  }
  function flyToRegion(id) {
    const r = state.meta.regions.find((x) => x.id === id);
    if (!r || !r.box) return;
    const b = L.latLngBounds([[r.box[0], r.box[2]], [r.box[1], r.box[3]]]);
    if (!map.getBounds().intersects(b) || map.getBoundsZoom(b) - map.getZoom() > 3) map.flyToBounds(b.pad(0.6), { duration: 1.1 });
  }

  let selToken = 0;
  async function select(sel) {
    const token = ++selToken;
    state.sel = sel;
    if (sel.kind === "region") flyToRegion(sel.id);
    state.history = [];
    drawRegions();
    Analysis.loading(sel);
    let r;
    try { r = await fetchResult(sel); }
    catch (e) { if (token === selToken) Analysis.error(e.message); return; }
    if (token !== selToken) return;
    if (r.error) return Analysis.error(r.error);
    state.result = r;
    syncRegionSelect();
    Logbook.visit(r, sel);
    Analysis.render();
    Bus.emit("result", r);
    if (state.cmpKey) loadCompare(state.cmpKey);
  }

  /* ---------------------------------------------------------------- region & compare selects (unchanged logic) */
  function syncRegionSelect() {
    const s = $("#region-select");
    const vs = varSpec();
    const opts = vs.point ? [["region:point", vs.label]]
      : state.meta.regions.filter((r) => (vs.regions_avail || []).includes(r.id)).map((r) => [`region:${r.id}`, r.label]);
    if (state.box && vs.gridded) opts.push(["box", "Your drawn box"]);
    if (state.sel.kind === "pixel") opts.push(["pixel", "Selected grid cell"]);
    s.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
    s.value = state.sel.kind === "region" ? `region:${state.sel.id}` : state.sel.kind;
    // the Place bar is no longer shown (places are picked on the map or from Regions); the hidden select still feeds "Compare with"

    const c = $("#compare-select");
    const cur = s.value;
    const copts = opts.filter(([v]) => v !== cur && v !== "pixel");
    c.innerHTML = `<option value="">nothing</option>` + copts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
    if (copts.some(([v]) => v === state.cmpKey)) c.value = state.cmpKey;
    else { state.cmpKey = ""; state.cmp = null; c.value = ""; }
    Bus.emit("compare");
  }
  async function loadCompare(key) {
    state.cmpKey = key;
    if (!key) { state.cmp = null; Bus.emit("compare"); return Analysis.drawChart(); }
    const sel = key.startsWith("region:") ? { kind: "region", id: key.slice(7) } : { kind: "box", box: state.box };
    let c;
    try { c = await fetchResult(sel); } catch (e) { toast(`Could not load the comparison: ${e.message}`); return; }
    if (c.error) { toast(c.error); return; }
    c._place = placeOf(sel, c);
    state.cmp = c;
    Bus.emit("compare");
    Analysis.drawChart();
  }

  /* ---------------------------------------------------------------- variable picker */
  function buildPicker() {
    $("#vp-list").innerHTML = state.meta.variables.map((v) => `
      <li><button data-v="${v.id}" aria-pressed="${v.id === state.v}">
        <span class="vp-glyph" style="--neg:${v.neg};--pos:${v.pos}">${glyph(v.id)}</span>
        <span class="vp-text"><b>${esc(varShort(v))}</b><small class="mono">${esc(instrumentOf(v))}</small>
          <span class="vp-def">${esc((v.definition || "").split(". ")[0])}.</span></span>
        <span class="vp-ramp" aria-hidden="true"><i style="background:${v.neg}"></i><i style="background:${v.pos}"></i></span>
        <span class="vp-meta mono">${v.gridded ? "map + regions" : (v.regions_avail || []).length + " region" + ((v.regions_avail || []).length > 1 ? "s" : "")}</span>
      </button></li>`).join("");
    $$("#vp-list button").forEach((b) => b.addEventListener("click", () => { closePicker(true); setVar(b.dataset.v); }));
  }
  function openPicker() {
    buildPicker();
    $("#var-picker").hidden = false; $("#var-pill").setAttribute("aria-expanded", "true");
    $("#vp-close").hidden = !state.v;
    ($('#vp-list button[aria-pressed="true"]') || $("#vp-list button"))?.focus();
    Bus.emit("picker");
  }
  function closePicker(force) {
    if (!state.v && force !== true) return;     // the first time, a choice is needed
    $("#var-picker").hidden = true; $("#var-pill").setAttribute("aria-expanded", "false");
  }
  function updatePill() {
    const vs = varSpec();
    $("#var-pill-label").textContent = vs ? varShort(vs) : "Choose a measurement";
    $("#var-pill-glyph").innerHTML = vs ? glyph(vs.id) : glyph("_");
    $("#var-pill").style.setProperty("--neg", vs ? vs.neg : "#e8c26e");
    $("#var-pill").style.setProperty("--pos", vs ? vs.pos : "#7cc6d6");
  }

  async function setVar(v, keepSel) {
    state.v = v;
    updatePill();
    const vs = varSpec();
    $("#draw").disabled = !vs.gridded;
    $("#draw").title = vs.gridded ? "Draw your own box on the map" : "Drawing needs a gridded measurement (vegetation or land temperature)";
    let sel = keepSel || state.sel;
    const avail = vs.regions_avail || [];
    if (vs.point) sel = { kind: "region", id: "point" };
    else if (!vs.gridded && (!sel || sel.kind !== "region" || !avail.includes(sel.id))) sel = { kind: "region", id: avail[0] };
    else if (vs.gridded && (!sel || (sel.kind === "region" && !avail.includes(sel.id))))
      sel = { kind: "region", id: avail.includes("new_delta") ? "new_delta" : avail[0] };
    if (!vs.gridded) drawnLayer.clearLayers();
    state.cmpKey = ""; state.cmp = null;
    $("#hint").textContent = hintText();
    state.sel = sel;
    drawRegions();
    await drawCells();
    await select(sel);
    Analysis.loadTrust();
    Bus.emit("var", vs);
  }
  function setMode(m) {
    state.mode = m;
    $("#mode-verdict").classList.toggle("on", m === "verdict"); $("#mode-verdict").setAttribute("aria-pressed", m === "verdict");
    $("#mode-rate").classList.toggle("on", m === "rate"); $("#mode-rate").setAttribute("aria-pressed", m === "rate");
    if (state.v) drawCells();
  }

  /* ---------------------------------------------------------------- popovers */
  function togglePop(btn, pop) {
    const open = pop.hidden;
    closePops();
    if (open) { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); btn.classList.add("active"); pop.querySelector("button, input")?.focus(); }
  }
  function closePops() {
    [["#tool-regions", "#regions-pop"], ["#tool-layers", "#layers-pop"]].forEach(([b, p]) => {
      $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); $(b).classList.remove("active");
    });
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $("#draw").addEventListener("click", startDrawing);
    $("#mode-verdict").addEventListener("click", () => setMode("verdict"));
    $("#mode-rate").addEventListener("click", () => setMode("rate"));
    $("#var-pill").addEventListener("click", () => ($("#var-picker").hidden ? openPicker() : closePicker()));
    $("#vp-close").addEventListener("click", closePicker);
    $("#tool-regions").addEventListener("click", () => togglePop($("#tool-regions"), $("#regions-pop")));
    $("#tool-layers").addEventListener("click", () => togglePop($("#tool-layers"), $("#layers-pop")));
    $$('#layers-pop input[name="base"]').forEach((i) => i.addEventListener("change", () => { setBase(i.value); Prefs.set("base", i.value); }));
    $("#lyr-labels").addEventListener("change", (e) => (e.target.checked ? labels.addTo(map) : map.removeLayer(labels)));
    $("#lyr-cells").addEventListener("change", (e) => (e.target.checked ? cellLayer.addTo(map) : map.removeLayer(cellLayer)));
    $("#region-select").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v.startsWith("region:")) select({ kind: "region", id: v.slice(7) });
      else if (v === "box") select({ kind: "box", box: state.box });
    });
    $("#compare-select").addEventListener("change", (e) => loadCompare(e.target.value));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || document.body.dataset.route !== "explorer") return;
      if (drawer) stopDrawing();
      else if (!$("#regions-pop").hidden || !$("#layers-pop").hidden) closePops();
      else if (!$("#var-picker").hidden) closePicker();
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".pop, .tool")) closePops();
    });
    Bus.on("pref", ({ k, val }) => {
      if (k === "mapMode") setMode(val);
      if (k === "base" && ready) setBase(val);
    });
  }

  /* called when the explorer page is shown */
  let opening = false;
  function show() {
    if (!ready) { initMap(); wire(); setMode(state.mode); }
    setTimeout(() => map.invalidateSize(), 60);
    if (!state.v && !opening) openPicker();
  }
  /* open a specific investigation (used by case files, logbook, landing) */
  async function open(v, sel, cmp) {
    opening = true;
    if (!ready) { initMap(); wire(); setMode(state.mode); }
    $("#var-picker").hidden = true; $("#var-pill").setAttribute("aria-expanded", "false");
    if (sel && sel.kind === "box") {
      state.box = sel.box;
      drawnLayer.clearLayers();
      const [la0, la1, lo0, lo1] = sel.box;
      L.rectangle([[la0, lo0], [la1, lo1]], { color: SEL_COLOR, weight: 3.5, fillOpacity: .1, className: "sel-glow" }).addTo(drawnLayer);
      map.fitBounds(L.latLngBounds([[la0, lo0], [la1, lo1]]).pad(0.8));
    }
    if (sel && sel.kind === "pixel") map.setView([sel.lat, sel.lon], Math.max(map.getZoom(), 9));
    try { await setVar(v, sel); } finally { opening = false; }
    if (cmp) {
      const key = `region:${cmp}`;
      if ((varSpec().regions_avail || []).includes(cmp)) { $("#compare-select").value = key; await loadCompare(key); }
    }
  }
  const invalidate = () => map && setTimeout(() => map.invalidateSize(), 320);

  return { show, open, select, setVar, openPicker, setMode, invalidate, varSpec, fetchResult, hintText };
})();
