/* Kemet, the guide: a docked companion that opens a small speech panel with
   tips for the current page, plain explanations of terms, a first-visit tour
   and occasional nudges. Optional (Settings), dismissible, never blocks controls. */
"use strict";

const Guide = (() => {
  const TERMS = {
    "Trend": "A steady rise or fall that runs through the whole record, not just one unusual year. TerraPulse looks for it month by month, comparing each January with other Januaries, and so on.",
    "Significant": "The pattern is unlikely to be chance alone. We call a trend confirmed when the q-value is below 0.05. Significant doesn’t mean large or important, and it doesn’t explain the cause.",
    "p-value": "If there were no trend at all, the p-value is the chance of seeing a pattern at least this strong anyway. Small p = hard to explain by luck. It is not the chance that the trend is real.",
    "q-value": "A p-value corrected for testing many places at once. Test 100 places and about 5 will look “significant” by luck; the q-value keeps those false alarms in check.",
    "95% range": "The interval where the true rate of change most likely lies. A narrow range means a precise estimate. If it crosses zero, the data can’t rule out “no change”.",
    "Sen’s slope": "How fast something changes, measured as the middle value of the slopes between every pair of points. One odd year can’t drag it around the way it can a straight-line fit.",
    "Mann-Kendall": "A trend test that only asks “did it go up or down?” between every pair of times. The seasonal version compares like with like (January with January), so summer and winter can’t fake a trend.",
    "Seasonal cycle": "The regular up-and-down of every year: hot summers, green growing seasons, winter rain. It is huge compared with most trends, so TerraPulse compares each month only with the same month in other years.",
    "Real but tiny": "The test can detect the change, but it is smaller than the amount that matters for this measurement. TerraPulse shows it in grey so it isn’t mistaken for an important finding.",
    "Sudden jump": "A step change, such as a new dam, a policy or a sensor change. TerraPulse checks whether a jump explains the data better than a steady trend, and reports the trend without it.",
    "Not confirmed": "The data might lean one way, but not strongly enough. That is not proof of “no change”: a longer record or a bigger change could still be detected.",
    "NDVI": "A greenness index from the light plants reflect. Near 0 is sand or city, about 0.3 sparse plants, above 0.6 dense crops.",
    "Land surface temperature": "How hot the ground itself is in the daytime, seen from space. Not the same as air temperature: cities and deserts get much hotter.",
    "NO₂": "Nitrogen dioxide, a gas from traffic, power plants and factories. The satellite measures how much is in the column of air above the ground.",
    "Grid cell": "One small square of the satellite map, with its own monthly record. Each cell is tested on its own, then corrected for testing many cells.",
  };

  const tips = {
    landing: () => ({ face: "happy", pose: "wave",
      text: ["Hi, I’m <b>Kemet</b>, the guardian of the Black Land. I help you read Earth’s pulse.",
             "Scroll down for the platform tour and some real findings, or go straight to the Earth Explorer."],
      terms: ["Trend", "Significant"],
      actions: [["Start exploring", "#/explorer"], ["Show me around", "tour"]] }),
    home: () => ({ face: "happy", pose: "hold",
      text: ["This is your <b>mission board</b>.", "Case files are ready-made investigations. Open one and I’ll set up the map, the place and, sometimes, a comparison for you."],
      terms: ["Trend", "Significant"], actions: [["Open the Earth Explorer", "#/explorer"], ["Take the tour", "tour"]] }),
    explorer: () => {
      if (!state.v) return { face: "think", pose: "point",
        text: ["First, choose <b>what</b> to explore.", "Each measurement comes from a different instrument. Vegetation and land temperature have a detailed map; the others are averages over preset regions."],
        terms: ["NDVI", "Land surface temperature", "NO₂"], actions: [] };
      const vs = varById(state.v), r = state.result;
      const steps = [
        { text: [`The map colours show each cell’s verdict: strong colour = confirmed <b>${esc(vs.pos_word)}</b> or <b>${esc(vs.neg_word)}</b>, pale = possible, grey = no confirmed trend, dashed = not enough data.`],
          terms: ["Grid cell", "Real but tiny"], skip: !vs.gridded },
        { text: ["Pick a place three ways: click a <b>dashed outline</b> (a preset region), click a <b>single cell</b>, or use <b>Draw a box</b> for your own area."], terms: ["Grid cell"] },
        r ? { text: [`The sheet on the right starts with <b>what we discovered</b>. ${verdictFamily(r.verdict) === "confirmed" ? "This one is confirmed by the evidence." : "This one isn’t confirmed, and the Evidence tab explains why."}`,
                    "Trend has the chart, Evidence says how sure we are, Data shows where the numbers come from, Science has the full statistics."],
              terms: ["Significant", "95% range", "Sen’s slope"] } : null,
        { text: ["Switch the map to <b>Rate</b> to see how fast each cell changes instead of whether it’s confirmed. The white dots mark confirmed trends."], terms: ["Sen’s slope"], skip: !vs.gridded },
      ].filter((s) => s && !s.skip);
      return { face: r && verdictFamily(r.verdict) === "confirmed" ? "happy" : "think", pose: "point", steps,
               actions: [["Ask about this result", "ask"], ["Change measurement", "picker"]] };
    },
    analysis: () => tips.explorer(),
    analyses: () => ({ face: "neutral", pose: "hold",
      text: ["This is your <b>logbook</b>.", "Save a finding with the bookmark on the analysis sheet. Opening an entry asks the pipeline again, so it’s always current."],
      terms: [], actions: [["Open the Earth Explorer", "#/explorer"]] }),
    companion: () => ({ face: "happy", pose: "rest",
      text: ["Ask about the finding you’re looking at, in English or Arabic.", "I only see the numbers TerraPulse computed, so I won’t invent data, and I’ll keep causes separate from what the data shows."],
      terms: ["p-value", "95% range"], actions: [] }),
    learn: () => ({ face: "think", pose: "hold",
      text: ["New to trends? Start with <b>Trend or noise?</b>, then <b>Significance</b>.", "Tap a term below for the short version."],
      terms: ["Trend", "Seasonal cycle", "p-value", "q-value", "95% range", "Mann-Kendall"], actions: [] }),
    settings: () => ({ face: "wink", pose: "wave",
      text: ["You can switch me off here. I won’t be offended.", "You can bring the welcome tour back from here too."],
      terms: [], actions: [] }),
  };

  const TOUR = [
    { sel: null, face: "happy", pose: "wave", route: null,
      text: "Welcome to <b>TerraPulse</b>. Together we’ll find out what is really changing on Earth, and how sure we can be. Four quick stops." },
    { sel: "#sidebar", msel: "#drawer-open", face: "neutral", pose: "point", route: null,
      text: "<b>The sidebar</b> is always here. <b>Explore</b> holds the map and your saved findings; <b>Learn &amp; Discover</b> has the AI Companion and the field guide.",
      mtext: "Tap the <b>menu</b> button to open the sidebar. <b>Explore</b> holds the map and your saved findings; <b>Learn &amp; Discover</b> has the AI Companion and the field guide." },
    { sel: '.sidebar [data-nav="explorer"]', msel: "#drawer-open", face: "think", pose: "point", route: null,
      text: "In the <b>Earth Explorer</b>: 1) choose a measurement, 2) pick a place, 3) read the verdict. Every number comes from real NASA data.",
      mtext: "In the menu, open the <b>Earth Explorer</b>: 1) choose a measurement, 2) pick a place, 3) read the verdict. Every number comes from real NASA data." },
    { sel: "#guide-dock", face: "happy", pose: "rest", route: null,
      text: "I live down here. Click me any time for tips about the page you’re on, or to explain a word. Ready?" },
  ];

  let open = false, step = 0, tourI = -1, peekT = null, route = "landing", ringRaf = 0;
  const small = () => matchMedia("(max-width: 860px)").matches;

  /* ---------------------------------------------------------------- spotlight ring (follows the target) */
  const ring = document.createElement("div");
  ring.className = "tour-ring"; ring.hidden = true; ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring);
  function target() {
    if (tourI < 0) return null;
    const s = TOUR[tourI], sel = small() && s.msel ? s.msel : s.sel;
    return sel ? document.querySelector(sel) : null;
  }
  function placeRing() {
    const t = target();
    const r = t && t.getBoundingClientRect();
    const shown = r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
                  && getComputedStyle(t).visibility !== "hidden";
    ring.hidden = !shown;
    if (shown) {
      const pad = 4, m = 4;   // keep the whole ring on screen, even for full-height targets like the sidebar
      const x0 = Math.max(m, r.left - pad), y0 = Math.max(m, r.top - pad);
      const x1 = Math.min(innerWidth - m, r.right + pad), y1 = Math.min(innerHeight - m, r.bottom + pad);
      Object.assign(ring.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px`,
                                  borderRadius: getComputedStyle(t).borderRadius === "50%" ? "50%" : "14px" });
    }
    ringRaf = tourI >= 0 ? requestAnimationFrame(placeRing) : 0;   // keep following while the tour is open
  }

  function el(id) { return document.getElementById(id); }
  function setFace(face) { el("guide-face").innerHTML = samiSVG({ head: true, face }); }

  function render() {
    const g = el("guide");
    g.hidden = !Prefs.get("guide");
    if (g.hidden) return;
    if (tourI >= 0) return renderTour();
    const t = (tips[route] || tips.landing)();
    setFace(t.face);
    el("guide-title").textContent = "Kemet";
    const steps = t.steps || [{ text: t.text, terms: t.terms }];
    step = Math.min(step, steps.length - 1);
    const s = steps[step];
    el("guide-step").textContent = steps.length > 1 ? `tip ${step + 1} of ${steps.length}` : "";
    el("guide-text").innerHTML = s.text.map((p) => `<p>${p}</p>`).join("");
    el("guide-terms").innerHTML = (s.terms || t.terms || []).length
      ? `<p class="mono">Explain a word</p>` + (s.terms || t.terms).map((k) => `<button data-term="${esc(k)}">${esc(k)}</button>`).join("") : "";
    $$("#guide-terms [data-term]").forEach((b) => b.addEventListener("click", () => explainTerm(b.dataset.term)));
    const acts = (t.actions || []).map(([l, a]) => `<button class="g-act" data-a="${a}">${esc(l)}</button>`).join("");
    const nav = steps.length > 1 ? `<span class="g-nav"><button data-nav="-1" aria-label="Previous tip" ${step === 0 ? "disabled" : ""}>‹</button><button data-nav="1" aria-label="Next tip" ${step === steps.length - 1 ? "disabled" : ""}>›</button></span>` : "";
    el("guide-foot").innerHTML = acts + nav;
    $$("#guide-foot [data-a]").forEach((b) => b.addEventListener("click", () => act(b.dataset.a)));
    $$("#guide-foot [data-nav]").forEach((b) => b.addEventListener("click", () => { step += +b.dataset.nav; render(); }));
  }

  function explainTerm(k) {
    setFace("think");
    el("guide-step").textContent = "explain a word";
    el("guide-text").innerHTML = `<p class="term-h">${esc(k)}</p><p>${esc(TERMS[k] || "")}</p>`;
    el("guide-foot").innerHTML = `<button class="g-act" data-back>← Back to tips</button>${route === "explorer" || route === "analysis" ? `<button class="g-act" data-learn>More in Learn →</button>` : ""}`;
    el("guide-foot").querySelector("[data-back]").addEventListener("click", render);
    el("guide-foot").querySelector("[data-learn]")?.addEventListener("click", () => { location.hash = "#/learn"; });
  }

  function act(a) {
    if (a === "tour") return startTour();
    if (a === "ask") { setOpen(false); if (state.result) Chat.openDrawer(); else location.hash = "#/companion"; return; }
    if (a === "picker") { setOpen(false); Explorer.openPicker(); return; }
    setOpen(false); location.hash = a;
  }

  /* ---------------------------------------------------------------- tour */
  function startTour() { tourI = 0; setOpen(true); renderTour(); }
  function renderTour() {
    const s = TOUR[tourI];
    cancelAnimationFrame(ringRaf); placeRing();
    setFace(s.face);
    el("guide-title").textContent = "Welcome tour";
    el("guide-step").textContent = `${tourI + 1} / ${TOUR.length}`;
    el("guide-text").innerHTML = `<p>${small() && s.mtext ? s.mtext : s.text}</p>`;
    el("guide-terms").innerHTML = "";
    el("guide-foot").innerHTML = `<button class="g-act ghost" data-skip>Skip</button><button class="g-act" data-next>${tourI === TOUR.length - 1 ? "Let’s explore" : "Next"}</button>`;
    el("guide-foot").querySelector("[data-skip]").addEventListener("click", endTour);
    el("guide-foot").querySelector("[data-next]").addEventListener("click", () => {
      if (tourI === TOUR.length - 1) { endTour(); if (route === "landing" || route === "home") location.hash = "#/explorer"; }
      else { tourI++; renderTour(); }
    });
    el("guide-foot").querySelector("[data-next]").focus({ preventScroll: true });
  }
  function endTour() {
    if (tourI < 0) return;
    tourI = -1; Prefs.set("welcomed", true);
    cancelAnimationFrame(ringRaf); ringRaf = 0; ring.hidden = true;
    setOpen(false);
  }

  /* ---------------------------------------------------------------- open / close / peek */
  function setOpen(on) {
    open = on;
    el("guide-bubble").hidden = !on;
    el("guide").classList.toggle("open", on);
    el("guide-dock").setAttribute("aria-expanded", on);
    el("guide-ping").hidden = true;
    if (on) { clearTimeout(peekT); el("guide-bubble").classList.remove("peek"); render(); }
    else if (tourI >= 0) endTour();
  }
  function peek(html, face = "happy") {
    if (!Prefs.get("guide") || !Prefs.get("nudges") || open) return;
    setFace(face);
    el("guide-title").textContent = "Kemet";
    el("guide-step").textContent = "";
    el("guide-text").innerHTML = `<p>${html}</p>`;
    el("guide-terms").innerHTML = "";
    el("guide-foot").innerHTML = `<button class="g-act" data-more>Tell me more</button><button class="g-act ghost" data-ok>Got it</button>`;
    el("guide-foot").querySelector("[data-more]").addEventListener("click", () => setOpen(true));
    el("guide-foot").querySelector("[data-ok]").addEventListener("click", () => { el("guide-bubble").hidden = true; el("guide-bubble").classList.remove("peek"); });
    el("guide-bubble").hidden = false; el("guide-bubble").classList.add("peek");
    clearTimeout(peekT);
    peekT = setTimeout(() => { if (!open) { el("guide-bubble").hidden = true; el("guide-bubble").classList.remove("peek"); el("guide-ping").hidden = false; } }, 12000);
  }
  function once(k) { const s = Store.get("nudged", {}); if (s[k]) return false; s[k] = 1; Store.set("nudged", s); return true; }

  /* ---------------------------------------------------------------- reacting to the app */
  Bus.on("route", (r) => {
    route = r; step = 0;
    if (tourI >= 0) return;
    if (open) render(); else setFace((tips[r] || tips.landing)().face);
    if (!Prefs.get("welcomed") && Prefs.get("guide") && (r === "landing" || r === "home"))
      setTimeout(() => {   // only if the visitor is still on that page and hasn't opened Kemet meanwhile
        if (!Prefs.get("welcomed") && Prefs.get("guide") && tourI < 0 && !open && route === r) startTour();
      }, r === "landing" ? 2600 : 900);
  });
  Bus.on("result", (r) => {
    if (open && tourI < 0) { render(); return; }
    const f = verdictFamily(r.verdict);
    if (once("first-result")) peek(`Your first finding! The verdict is at the top of the sheet. ${f === "confirmed" ? "The green check means the evidence is strong." : "This one isn’t confirmed. That’s an honest answer too, not a failure."}`, f === "confirmed" ? "happy" : "think");
    else if (f !== "confirmed" && once("first-unconfirmed")) peek("Not confirmed doesn’t mean nothing changed. The <b>Evidence</b> tab shows the smallest trend this record could have caught.", "think");
    else if (r.change_point && r.change_point.significant && once("first-jump")) peek("I spotted a <b>sudden jump</b> in this record. The chart marks it with a dashed line, and the trend is shown without it.", "wow");
    else setFace(f === "confirmed" ? "happy" : "think");
  });
  Bus.on("compare", () => { if (state.cmp && once("first-compare")) peek("Two places on one chart, same scale. Ask me to <b>compare the two</b> if you’d like it in words.", "happy"); });
  Bus.on("drawing", () => { if (once("first-draw")) peek("Drag a rectangle over the coloured cells. I’ll average them and test your box live.", "neutral"); });
  Bus.on("noresult", () => setFace("wow"));
  Bus.on("pref", ({ k }) => { if (k === "guide") { if (!Prefs.get("guide")) setOpen(false); render(); } });

  function wire() {
    el("guide-dock").addEventListener("click", () => setOpen(!open || el("guide-bubble").classList.contains("peek")));
    el("guide-close").addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { setOpen(false); el("guide-dock").focus(); } });
  }
  wire(); render();
  return { startTour, setOpen, render, TERMS };
})();
