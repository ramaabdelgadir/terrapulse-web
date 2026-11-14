/* AI chat, shared by the AI Companion page and the in-map "Ask" drawer.
   Same backend call as the original "Ask TerraPulse" box: POST /api/explain with
   the current result as context (and the comparison, when one is loaded). */
"use strict";

const Chat = (() => {
  let msgs = [];          // { role: "user"|"ai"|"pending"|"err", text, src }
  let busy = false;
  let seq = 0;            // id of the current question; answers to older questions are ignored
  let ctrl = null;        // AbortController of the request in flight
  const TIMEOUT_MS = 60000;      // the server gives up on both free models within ~45 s

  const SUGGEST = () => {
    const r = state.result;
    const f = r ? verdictFamily(r.verdict) : null;
    const list = [
      { q: "", label: "What does this trend mean?" },
      f && f !== "confirmed"
        ? { q: "Why was this trend not statistically confirmed? What would it take to confirm it?", label: "Why was this trend not statistically confirmed?" }
        : { q: "What does 'significant' mean here, and how confident should I be?", label: "How sure are we?" },
      { q: "Explain the 95% confidence interval of the rate in simple words.", label: "Explain this confidence interval." },
      { q: "Help me understand the chart: what do the thin line, the dots, the trend line and the shaded band show?", label: "Help me understand this visualization." },
      { q: "Why might this be happening? Separate what the data shows from possible causes.", label: "Why might this happen?" },
      { q: "Based on this result, what should I explore next in TerraPulse (other places or measurements), and why?", label: "What should I explore next?" },
    ];
    if (state.cmp) list.splice(1, 0, { q: "__compare__", label: "Compare the two places" });
    return list;
  };

  function contextLine() {
    const r = state.result;
    if (!r) return `<div class="ctx empty"><span class="mono">No finding selected</span><p>Choose a place in the Earth Explorer, or open a saved analysis, and the companion will talk about that result.</p></div>`;
    return `<div class="ctx"><span class="mono">Talking about</span><p><b>${esc(headline(r, state.sel))}</b></p>
      <p class="ctx-meta">${esc(r.variable_label)} · ${esc(r.title)}${state.cmp ? ` · compared with ${esc(cap(state.cmp._place))}` : ""}</p></div>`;
  }

  function msgHTML(m) {
    const rtl = /[؀-ۿ]/.test(m.text);
    if (m.role === "pending") return `<div class="msg ai pending" role="status">${PULSE_SVG}<span>${state.lang === "ar" ? "جارٍ التفكير…" : "Thinking…"}</span>
      <button type="button" class="stop" data-stop>${state.lang === "ar" ? "إيقاف" : "Stop"}</button></div>`;
    return `<div class="msg ${m.role}" ${rtl ? 'dir="rtl" lang="ar"' : ""}>${m.role === "ai" ? `<span class="who">${samiSVG({ head: true, face: "happy" })}</span>` : ""}
      <div class="bubble">${esc(m.text).replace(/\n{2,}/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>").replace(/\n/g, "<br>")}
      ${m.src ? `<span class="src">Answered by ${esc(m.src)}, using only the numbers TerraPulse computed.</span>` : ""}</div></div>`;
  }

  function build(el) {
    const big = el.classList.contains("big");
    el.innerHTML = `
      ${big ? "" : `<div class="chat-ctx" data-ctx></div>`}
      <div class="msgs" aria-live="polite" data-msgs></div>
      <div class="chat-bar">
        <div class="chat-suggest" data-suggest id="sg-${el.dataset.chat}" role="group" aria-label="Suggested questions"></div>
        <form class="chat-form" data-form>
          <button type="button" class="sug-toggle" data-sugt aria-controls="sg-${el.dataset.chat}" aria-expanded="false" title="Suggested questions">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg><span>Ideas</span></button>
          <label class="sr" for="ci-${el.dataset.chat}">Your question</label>
          <input id="ci-${el.dataset.chat}" autocomplete="off" maxlength="600">
          <button type="submit" class="send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 6l6 6-6 6"/></svg></button>
        </form>
      </div>
      ${big ? "" : `<div class="chat-lang seg small" role="group" aria-label="Answer language"><button data-lang="en">English</button><button data-lang="ar" lang="ar">عربي</button></div>`}`;
    el.querySelector("[data-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = el.querySelector("input"), q = inp.value.trim();
      if (!q) return;
      inp.value = "";
      sugUser = null;
      ask(q);
    });
    $$("[data-lang]", el).forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    el.querySelector("[data-sugt]").addEventListener("click", () => { sugUser = !sugOpen(); renderAll(); });
  }

  /* suggested questions: a small pop-up above the text box, so they never cover the answer.
     Open by default only while the conversation is empty; the "Ideas" button shows or hides them any time. */
  let sugUser = null;
  const sugOpen = () => !busy && (sugUser !== null ? sugUser : msgs.length === 0);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sugUser) { sugUser = false; renderAll(); } });
  document.addEventListener("click", (e) => {
    if (sugUser && !e.target.closest(".chat-bar")) { sugUser = false; renderAll(); }
  });

  function renderAll() {
    $$("[data-chat]").forEach((el) => {
      if (!el.firstElementChild) build(el);
      const big = el.classList.contains("big");
      const ctx = el.querySelector("[data-ctx]");
      if (ctx) ctx.innerHTML = contextLine();
      const box = el.querySelector("[data-msgs]");
      box.innerHTML = msgs.length ? msgs.map(msgHTML).join("")
        : big ? `<div class="chat-empty">${samiSVG({ pose: "wave", face: "happy" })}<h2>Hi, I’m Kemet.</h2>
            <p>${state.result ? "Ask me anything about this finding, or start with one of the questions below." : "Open a finding first, and I’ll explain it in plain words. Questions about how TerraPulse works are welcome too."}</p></div>`
        : `<p class="chat-hint">Ask in your own words, or tap a question.</p>`;
      const sug = el.querySelector("[data-suggest]");
      const open = sugOpen();
      sug.hidden = !open;                                  // also hidden while the AI is thinking
      sug.innerHTML = open ? SUGGEST().map((s, i) => `<button type="button" data-i="${i}">${esc(s.label)}</button>`).join("") : "";
      $$("[data-suggest] button", el).forEach((b) => b.addEventListener("click", () => {
        const s = SUGGEST()[+b.dataset.i]; sugUser = null; if (s) ask(s.q, s.label);
      }));
      const t = el.querySelector("[data-sugt]");
      t.setAttribute("aria-expanded", open); t.classList.toggle("on", open); t.disabled = busy;
      t.querySelector("span").textContent = state.lang === "ar" ? "أفكار" : "Ideas";
      el.querySelector("[data-stop]")?.addEventListener("click", stop);
      const inp = el.querySelector("input");
      inp.placeholder = state.lang === "ar" ? "اسأل عن هذه النتيجة…" : (state.result ? "Ask about this result…" : "Ask a question…");
      inp.dir = state.lang === "ar" ? "rtl" : "ltr";
      $$("[data-lang]", el).forEach((b) => { b.classList.toggle("on", b.dataset.lang === state.lang); b.setAttribute("aria-pressed", b.dataset.lang === state.lang); });
      el.querySelector("button.send").disabled = busy;
      box.scrollTop = box.scrollHeight;
    });
    const co = $("#co-context"); if (co) co.innerHTML = contextLine() + (state.result ? `<a href="#/explorer" class="link">Back to the map →</a>` : `<a href="#/explorer" class="link">Open the Earth Explorer →</a> <a href="#/analyses" class="link">My Analyses →</a>`);
    $$(".companion [data-lang]").forEach((b) => { b.classList.toggle("on", b.dataset.lang === state.lang); b.setAttribute("aria-pressed", b.dataset.lang === state.lang); });
  }

  function setLang(l) { state.lang = l; Prefs.set("lang", l); renderAll(); }

  async function ask(question, label) {
    if (busy) return;
    const compare = question === "__compare__";
    if (compare && !state.cmp) return;
    const q = compare ? "" : question;
    const my = ++seq;
    msgs.push({ role: "user", text: label || question || "What does this trend mean?" });
    msgs.push({ role: "pending" });
    busy = true; renderAll();
    Bus.emit("asking");
    ctrl = new AbortController();
    const timer = setTimeout(() => ctrl && ctrl.abort("timeout"), TIMEOUT_MS);
    let reply;
    try {
      const r = await fetch("/api/explain", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ context: state.result, compare: compare ? state.cmp : null,
                               question: q || null, lang: state.lang, history: state.history }) });
      if (!r.ok) throw new Error(r.status >= 500 ? "the server had a problem (see the terminal running uvicorn)" : r.statusText);
      const res = await r.json();
      reply = { role: "ai", text: res.answer, src: res.source };
      if (my === seq) state.history.push({ role: "user", content: label || q || "Explain this result." }, { role: "assistant", content: res.answer });
    } catch (e) {
      const why = e.name === "AbortError" || e === "timeout"
        ? (ctrl && ctrl.signal.reason === "timeout" ? "the AI took too long. Please try again." : "stopped.")
        : `the explainer could not answer: ${e.message}`;
      reply = { role: "err", text: cap(why) };
    } finally {
      clearTimeout(timer);
    }
    if (my !== seq) return;                // the place changed or the user pressed Stop: drop this answer
    ctrl = null;
    const k = msgs.findIndex((m) => m.role === "pending");
    if (k >= 0) msgs.splice(k, 1, reply); else msgs.push(reply);
    busy = false; renderAll();
  }

  function stop() {
    if (!busy) return;
    seq++;                                  // the answer, if it still arrives, is ignored
    if (ctrl) ctrl.abort("user");
    ctrl = null;
    const k = msgs.findIndex((m) => m.role === "pending");
    if (k >= 0) msgs.splice(k, 1, { role: "err", text: state.lang === "ar" ? "تم الإيقاف." : "Stopped." });
    busy = false; renderAll();
  }

  /* a new finding starts a new conversation; cancel any question still waiting */
  function reset() {
    if (busy) { seq++; if (ctrl) ctrl.abort("user"); ctrl = null; busy = false; }
    msgs = []; sugUser = null; renderAll();
  }

  function openDrawer() {
    $("#ask-drawer").hidden = false;
    $("#sheet").classList.add("asking"); document.body.classList.add("asking");
    Explorer.invalidate();                     // the panel is wider while asking: let the map re-measure
    renderAll();
    setTimeout(() => $("#ask-drawer input")?.focus(), 50);
  }
  function closeDrawer() { $("#ask-drawer").hidden = true; $("#sheet").classList.remove("asking"); document.body.classList.remove("asking"); Explorer.invalidate(); $("#ask-open").focus(); }
  Bus.on("route", (r) => { if (r !== "explorer" && r !== "analysis") document.body.classList.remove("asking"); else if (!$("#ask-drawer").hidden) document.body.classList.add("asking"); });

  Bus.on("result", reset);
  Bus.on("compare", renderAll);
  Bus.on("noresult", reset);
  Bus.on("pref", ({ k, val }) => { if (k === "lang") { state.lang = val; renderAll(); } });

  function wire() {
    $("#ask-open").addEventListener("click", () => ($("#ask-drawer").hidden ? openDrawer() : closeDrawer()));
    $("#ask-close").addEventListener("click", closeDrawer);
    $$(".companion .seg [data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  }
  wire();
  return { renderAll, ask, stop, openDrawer, closeDrawer, isBusy: () => busy };
})();
