"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return r.json();
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const Bus = {
  h: {},
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); },
  emit(ev, data) { (this.h[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
};

const Store = {
  get(k, d) { try { const v = localStorage.getItem("tp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("tp." + k, JSON.stringify(v)); } catch (e) {} },
};

const PREF_DEFAULTS = { guide: true, nudges: true, mapMode: "verdict", base: "imagery", lang: "en",
                        reduceMotion: false, sidebarCollapsed: false, welcomed: false };
const Prefs = {
  v: Object.assign({}, PREF_DEFAULTS, Store.get("prefs", {})),
  get(k) { return this.v[k]; },
  set(k, val) { this.v[k] = val; Store.set("prefs", this.v); Bus.emit("pref", { k, val }); },
};
if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches && Store.get("prefs", null) == null) Prefs.v.reduceMotion = true;

const state = { meta: null, v: null, mode: Prefs.get("mapMode"), sel: null, result: null, cmpKey: "", cmp: null,
                lang: Prefs.get("lang"), history: [], box: null, loading: false };

const MINUS = "−";
function fmt(x, sig = 2, sign = true) {
  if (x === null || x === undefined || !isFinite(x)) return "–";
  const a = Math.abs(x);
  let s;
  if (a === 0) s = "0";
  else if (a >= 100) s = a.toFixed(0);
  else if (a >= 10) s = a.toFixed(1);
  else s = a.toPrecision(sig).replace(/e.*$/, "");
  const pre = x < 0 ? MINUS : (sign && x > 0 ? "+" : "");
  return pre + s;
}
const fmtP = (p) => (p == null || !isFinite(p)) ? "–" : p < 0.001 ? "< 0.001" : "= " + (p < 0.01 ? p.toFixed(3) : p.toFixed(2));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SHORT_UNITS = (u) => (u || "").replace(/\s*\(.*\)/, "").replace("cm water", "cm");
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function hexA(h, a) { const p = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return `rgba(${p.join(",")},${a})`; }

const C = { ink: "#eef3ec", ink2: "#c9d8d4", muted: "#a3bab7", rule: "#3c565e", none: "#BFC6C1",
            nile: "#1A78A0", ochre: "#B5762A", neutral: "#E9ECEA", tiny: "#8E9893",
            yes: "#0a9a7a", maybe: "#c77a00", no: "#7d9896" };

const PHRASE = {
  ndvi:        { inc: "{P} {be} getting greener", dec: "{P} {be} losing its green", noun: "vegetation" },
  lst:         { inc: "The land surface in {p} {be} warming", dec: "The land surface in {p} {be} cooling", noun: "surface temperature" },
  precip:      { inc: "Rainfall in {p} {be} increasing", dec: "Rainfall in {p} {be} declining", noun: "rainfall" },
  groundwater: { inc: "{P} {be} gaining stored water", dec: "{P} {be} losing stored water", noun: "stored water" },
  cairo_t2m:   { inc: "The air in {p} {be} warming", dec: "The air in {p} {be} cooling", noun: "air temperature" },
  no2:         { inc: "The air over {p} {be} getting more polluted", dec: "The air over {p} {be} getting cleaner", noun: "nitrogen dioxide" },
  station_temp: { inc: "The air at {p} {be} warming", dec: "The air at {p} {be} cooling", noun: "air temperature" },
  et:          { inc: "{P} {be} evaporating more water", dec: "{P} {be} evaporating less water", noun: "evapotranspiration" },
};
const PLACE = { nile_delta: "the Nile Delta", new_delta: "the New Delta", greater_cairo: "Greater Cairo",
                north_coast: "the Mediterranean coast", amazon: "the central Amazon", alexandria: "Alexandria", point: "Cairo" };

function placeOf(sel, r) {
  if (sel.kind === "region") return PLACE[sel.id] || (r && r.title) || sel.id;
  if (sel.kind === "box") return "your box";
  return "this grid cell";
}

function headline(r, sel) {
  const ph = PHRASE[r.variable] || PHRASE.ndvi;
  const p = placeOf(sel, r);
  const fill = (tpl, be) => tpl.replace("{P}", cap(p)).replace("{p}", p).replace("{be}", be);
  const dir = (r.verdict || "").endsWith("increase") ? "inc" : "dec";
  if (r.verdict === "significant_but_small") return fill(ph[dir], "is") + " very slightly: detectable, but too small to matter.";
  if (r.verdict.startsWith("significant_")) return fill(ph[dir], "is") + ", and the evidence is strong.";
  if (r.verdict.startsWith("possible_")) return fill(ph[dir], "may be") + ", but it isn’t confirmed yet.";
  if (r.verdict === "no_significant_trend") return `No confirmed trend in ${ph.noun} for ${p}.`;
  return `Not enough data to judge ${p}.`;
}

function verdictFamily(v) {
  if (!v) return "insufficient";
  if (v === "significant_but_small") return "tiny";
  if (v.startsWith("significant_")) return "confirmed";
  if (v.startsWith("possible_")) return "possible";
  if (v === "no_significant_trend") return "none";
  return "insufficient";
}
const BADGE = {
  confirmed:    { label: "Trend confirmed by the evidence", short: "Confirmed", icon: "check" },
  tiny:         { label: "Real, but too small to matter", short: "Real but tiny", icon: "dot" },
  possible:     { label: "Possible trend, not confirmed", short: "Not confirmed", icon: "dash" },
  none:         { label: "Not enough evidence for a trend", short: "No confirmed trend", icon: "dash" },
  insufficient: { label: "Not enough data to judge", short: "Insufficient data", icon: "gap" },
};
function badgeHTML(verdict, long = true) {
  const f = verdictFamily(verdict), b = BADGE[f];
  const ic = { check: '<path d="M7 12.5l3 3 7-7"/>', dash: '<path d="M7.5 12h9"/>', dot: '<circle cx="12" cy="12" r="2.2"/>', gap: '<path d="M7.5 12h2M11 12h2M14.5 12h2"/>' }[b.icon];
  return `<span class="badge b-${f}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${long ? b.label : b.short}</span>`;
}

function evidenceWords(r) {
  if (r.verdict === "significant_but_small") return "Real but tiny";
  if (r.verdict.startsWith("significant_")) return r.q < 0.01 ? "Strong" : "Moderate";
  if (r.verdict.startsWith("possible_")) return "Weak, not confirmed";
  if (r.verdict === "no_significant_trend") return "No trend confirmed";
  return "Not enough data";
}

const GLYPH = {
  ndvi: '<path d="M12 20c0-6 0-9 6-14-7 0-11 3-11 8 0 2 1 4 5 6z"/><path d="M12 20c-1-3-3-6-6-8"/>',
  lst: '<circle cx="12" cy="9" r="3.4"/><path d="M12 2.8v1.6M12 13.6v1.2M5.8 9H4.2M19.8 9h-1.6M7.6 4.6l1.1 1.1M15.3 4.6l-1.1 1.1"/><path d="M3.5 20c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0"/>',
  precip: '<path d="M6.5 13.5a4 4 0 0 1 .7-7.9 5 5 0 0 1 9.6 1.4 3.3 3.3 0 0 1 .2 6.5z"/><path d="M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5"/>',
  no2: '<circle cx="12" cy="12" r="2.6"/><circle cx="5.5" cy="16.5" r="2"/><circle cx="18.5" cy="16.5" r="2"/><path d="M10 13.5l-3 2M14 13.5l3 2"/><path d="M8 5.5c1-1.5 3-1.5 4 0s3 1.5 4 0"/>',
  station_temp: '<path d="M10 4.5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z"/><path d="M12 9v7"/><circle cx="12" cy="16.8" r="1.4"/><path d="M17 6h2.5M17 9h2.5"/>',
  _: '<circle cx="12" cy="12" r="7"/><path d="M5 12h14"/>',
};
const glyph = (id, cls = "") => `<svg class="glyph ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPH[id] || GLYPH._}</svg>`;
const SHORT_LABEL = {
  ndvi: "Vegetation", lst: "Land surface temperature", precip: "Rainfall",
  no2: "Air pollution (NO₂)", station_temp: "Ground station temperature",
};
const varShort = (v) => SHORT_LABEL[v.id] || v.label;
const varById = (id) => state.meta && state.meta.variables.find((x) => x.id === id);
const instrumentOf = (v) => (v.source || "").replace(/ via .*/, "");

const keyOf = (v, sel) => sel.kind === "region" ? `${v}|r|${sel.id}` : sel.kind === "box" ? `${v}|b|${sel.box.join(",")}` : `${v}|p|${sel.lat},${sel.lon}`;
const Logbook = {
  saved() { return Store.get("saved", []); },
  history() { return Store.get("history", []); },
  entry(r, sel) {
    return { key: keyOf(r.variable, sel), v: r.variable, sel, verdict: r.verdict, title: headline(r, sel),
             place: cap(placeOf(sel, r).replace(/^the /, "")), varLabel: r.variable_label, at: Date.now() };
  },
  isSaved(key) { return this.saved().some((e) => e.key === key); },
  toggleSave(r, sel) {
    const e = this.entry(r, sel), list = this.saved();
    const i = list.findIndex((x) => x.key === e.key);
    if (i >= 0) list.splice(i, 1); else list.unshift(e);
    Store.set("saved", list); Bus.emit("logbook");
    return i < 0;
  },
  remove(key) { Store.set("saved", this.saved().filter((e) => e.key !== key)); Bus.emit("logbook"); },
  visit(r, sel) {
    const e = this.entry(r, sel);
    const list = this.history().filter((x) => x.key !== e.key);
    list.unshift(e); Store.set("history", list.slice(0, 12)); Bus.emit("logbook");
  },
  clearHistory() { Store.set("history", []); Bus.emit("logbook"); },
  clearAll() { Store.set("history", []); Store.set("saved", []); Bus.emit("logbook"); },
};
function when(ts) {
  const d = new Date(ts), now = Date.now(), m = Math.round((now - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

let toastT = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false; t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove("on"); setTimeout(() => (t.hidden = true), 300); }, 2600);
}

const PULSE_SVG = '<svg class="pulse-line" viewBox="0 0 120 24" aria-hidden="true"><path d="M0 14h34l5-9 7 16 6-12 4 5h64"/></svg>';
