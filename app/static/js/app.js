"use strict";

(function () {
  const ROUTES = ["landing", "home", "explorer", "analysis", "analyses", "companion", "learn", "settings"];
  const TITLES = { landing: "", home: "Home", explorer: "Earth Explorer", analysis: "Analysis", analyses: "My Analyses",
                   companion: "AI Companion", learn: "Learn & Discover", settings: "Settings" };
  const mobile = () => matchMedia("(max-width: 860px)").matches;

  function collapse(on) {
    document.body.classList.toggle("sb-collapsed", on);
    $("#sb-collapse").setAttribute("aria-pressed", on);
    $("#sb-collapse").setAttribute("aria-label", on ? "Expand sidebar" : "Collapse sidebar");
    $$(".sidebar a[data-nav]").forEach((a) => (on ? a.setAttribute("title", a.textContent.trim()) : a.removeAttribute("title")));
    Explorer.invalidate();
  }
  function drawer(on) {
    document.body.classList.toggle("drawer-open", on);
    $("#scrim").hidden = !on;
    $("#drawer-open").setAttribute("aria-expanded", on);
    if (on) $(".sidebar a[aria-current]")?.focus() || $(".sidebar a")?.focus();
  }
  $("#sb-collapse").addEventListener("click", () => collapse(!document.body.classList.contains("sb-collapsed")));
  $("#drawer-open").addEventListener("click", () => drawer(true));
  $("#drawer-close").addEventListener("click", () => drawer(false));
  $("#scrim").addEventListener("click", () => drawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("drawer-open")) { drawer(false); $("#drawer-open").focus(); } });
  collapse(!!Prefs.get("sidebarCollapsed"));

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-scroll]");
    if (!a) return;
    e.preventDefault();
    const t = document.getElementById(a.dataset.scroll);
    if (t) t.scrollIntoView({ behavior: Prefs.get("reduceMotion") ? "auto" : "smooth", block: "start" });
  });

  function parse() {
    const h = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    return ROUTES.includes(h) ? h : h === "" ? "landing" : "home";
  }
  function show(route) {
    const page = route === "analysis" ? "explorer" : route;
    document.body.dataset.route = route;
    $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === page));
    $$(".sidebar a[data-nav]").forEach((a) => {
      const on = a.dataset.nav === page || (page === "explorer" && a.dataset.nav === "explorer");
      on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
    });
    $("#topbar-page").textContent = TITLES[route];
    document.title = route === "landing" ? "TerraPulse — Explore Earth, one discovery at a time" : `${TITLES[route]} · TerraPulse`;
    drawer(false);
    if (!state.meta) return;
    if (route === "landing") Landing.build();
    if (route === "home") Pages.home();
    if (route === "explorer" || route === "analysis") {
      Explorer.show();
      if (route === "analysis") { if (state.result) Analysis.expand(true); else location.replace("#/explorer"); }
      else if (Analysis.sheetState() === "expanded") Analysis.expand(false);
    }
    if (route === "analyses") Pages.analyses();
    if (route === "companion") { if (!$("#co-sami").firstChild) $("#co-sami").innerHTML = samiSVG({ pose: "rest", face: "happy" }); Chat.renderAll(); }
    if (route === "learn") Pages.learn();
    if (route === "settings") Pages.settings();
    if (route !== "explorer" && route !== "analysis") window.scrollTo(0, 0);
    $("#main").scrollTop = 0;
    Bus.emit("route", route);
  }
  addEventListener("hashchange", () => show(parse()));

  const applyMotion = () => document.body.classList.toggle("calm", !!Prefs.get("reduceMotion"));
  applyMotion();
  Bus.on("pref", ({ k, val }) => {
    if (k === "reduceMotion") applyMotion();
    if (k === "sidebarCollapsed") collapse(val);
  });

  (async function boot() {
    show(parse());
    try { state.meta = await api("/api/meta"); }
    catch (e) {
      $("#sb-status").classList.add("bad");
      $("#sb-status-text").textContent = "The TerraPulse service isn’t answering";
      return;
    }
    $("#demo").hidden = !state.meta.dummy;
    $("#sb-status").classList.add(state.meta.dummy ? "demo" : "ok");
    $("#sb-status-text").textContent = state.meta.dummy ? "Demonstration data" : `Live · ${state.meta.variables.length} NASA & NOAA datasets`;
    const n = Logbook.saved().length; $("#sb-count").hidden = !n; $("#sb-count").textContent = n;
    Bus.emit("meta", state.meta);
    show(parse());
  })();
})();
