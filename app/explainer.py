import json
import os
import time
import urllib.error
import urllib.request

try:
    from .envfile import report
except ImportError:
    from envfile import report
report()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free",
          "nvidia/nemotron-3.5-lightning:free"]


def models():
    custom = [m.strip() for m in os.getenv("LLM_MODEL", "").split(",") if m.strip()]
    return [m for m in (custom or MODELS) if m.endswith(":free")]


TIMEOUTS = {"nvidia/nemotron-3-ultra-550b-a55b:free": 25, "nvidia/nemotron-3.5-lightning:free": 20}


def call_openrouter(model, system, msgs, think=False):
    body = {"model": model, "max_tokens": 700,
            "messages": [{"role": "system", "content": system}] + msgs}
    if not think:
        body["reasoning"] = {"enabled": False, "exclude": True}
    req = urllib.request.Request(
        OPENROUTER_URL, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                 "X-Title": "TerraPulse"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUTS.get(model, 20)) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 400 and not think:
            return call_openrouter(model, system, msgs, think=True)
        raise
    if "error" in data:
        raise RuntimeError(str(data["error"]))
    text = data["choices"][0]["message"].get("content") or ""
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()


SYSTEM = """You are Kemet, the AI companion inside TerraPulse (Kemet, "the Black Land", is the ancient Egyptian name for the fertile Nile soil). TerraPulse is a NASA Space Apps 2026 tool that finds long-term trends in \
NASA Earth observation data. Your readers are students and the public in Egypt and beyond. They can already see \
the numbers and the chart on screen; they ask you because they do not know what those numbers MEAN. Your job is \
to be the friendly expert who tells them.

You receive CONTEXT (the computed result on screen), sometimes COMPARE_WITH (a second result), and PLACE_NOTES \
(well-documented facts about the place and the variable).

How to answer:
1. Start with the meaning in one plain sentence: "Vegetation in the New Delta has clearly increased." \
Do not open by listing numbers. Describe only what the data shows; no speculation anywhere.
2. Use at most two numbers in the whole answer, only from CONTEXT, rounded, with units. Never invent or \
recompute a number. Never mention p, q, Sen's slope or other jargon unless the user asks about them.
3. Reasons: use ONLY the facts in PLACE_NOTES. Do not add causes, events, projects or numbers from your \
own knowledge, and do not guess. Present a fact as context that fits the change, never as a proven cause: \
"This area is being reclaimed as irrigated farmland, which fits the greening" - not "irrigation caused it". \
Only use a fact that matches the direction of the change. If no fact in PLACE_NOTES fits, say plainly that \
the data shows the change but cannot tell us why, and name one kind of data that could.
4. Say how sure we are in everyday words, in one short sentence: "very clear, not a fluke", "a hint, not \
confirmed", or "too noisy to tell yet, which is not the same as no change". "significant_but_small" means \
real but too small to matter in practice.
5. Special cases, one sentence each, only when present: a sudden jump (change_point.significant): say when, \
and that it is a step, not a steady trend; a record that was cut (cleaning.record_cut_after): say why; \
CONTEXT.dummy true: say it is demonstration data.
6. Length: 60 to 110 words, 2 or 3 short paragraphs, no headings, no bullet lists, no closing summary, no \
"let me know if". When comparing two places, focus on the one key difference, with any PLACE_NOTES fact that fits it.
7. Reply in {lang_name}. In Arabic use simple Modern Standard Arabic, Western digits, and keep NDVI, MODIS, \
NO2 in Latin script."""

PLACE_NOTES = {
    "new_delta": "Desert land west of the Nile Delta, along the Cairo-Alexandria desert road, that Egypt has been "
                 "reclaiming for irrigated agriculture since the late 20th century; the national New Delta "
                 "project, launched in 2021, expands this.",
    "alexandria": "Egypt's second-largest city, on the Mediterranean coast. Urban areas have expanded onto "
                  "surrounding agricultural land.",
    "greater_cairo": "Egypt's capital region and largest urban area. Nitrogen dioxide there comes mainly from "
                     "road traffic, power generation and industry. New cities are being built in the desert "
                     "around it.",
    "nile_delta": "Egypt's main agricultural region, irrigated from the Nile. Towns and cities have expanded onto "
                  "farmland, and desert at its edges has been reclaimed for new farms.",
    "north_coast": "Egypt's wettest region: almost all rain falls between October and March, and yearly totals "
                   "vary a lot, which makes trends hard to detect.",
    "amazon": "Tropical rainforest around Manaus, Brazil. Severe droughts were recorded in 2005, 2010, 2015-16 "
              "and 2023-24; rainfall there varies with El Nino.",
}
VAR_NOTES = {
    "ndvi": "NDVI measures how green and dense vegetation is: near 0.1 for bare desert, higher for crops and "
            "forest. New irrigated farmland raises it; buildings replacing fields lower it.",
    "lst": "Land surface temperature is the temperature of the ground surface measured by satellite in the "
           "daytime, not the air temperature. Built-up and bare surfaces heat more than irrigated vegetation.",
    "precip": "Rainfall from the NASA GPM IMERG satellite record.",
    "no2": "Nitrogen dioxide is produced mainly by burning fuel (vehicles, power plants, industry).",
    "station_temp": "Air temperature from a weather station at Alexandria airport, used to check the satellite data.",
}

QUESTION_BRIEFS = {
    "Why might this be happening? Separate what the data shows from possible causes.":
        "Why might this be happening? Use only the facts in PLACE_NOTES, as context that fits the change, not as proven causes.",
    "What does 'significant' mean here, and how confident should I be?":
        "How sure can I be about this? Explain in everyday words, with a simple comparison, no jargon.",
}


def place_notes(ctx):
    ctx = ctx or {}
    var = ctx.get("variable") or ctx.get("var") or ""
    title = (ctx.get("title") or "").lower()
    reg = ctx.get("region") or ctx.get("id") or next((k for k in PLACE_NOTES if k.replace("_", " ") in title), None)
    if not reg:
        names = {"new delta": "new_delta", "alexandria": "alexandria", "cairo": "greater_cairo",
                 "mediterranean": "north_coast", "amazon": "amazon", "nile delta": "nile_delta"}
        reg = next((v for k, v in names.items() if k in title), None)
    out = {}
    if reg in PLACE_NOTES:
        out["place"] = PLACE_NOTES[reg]
    lab = (ctx.get("variable_label") or "").lower()
    v = var if var in VAR_NOTES else next((k for k, n in [("ndvi", "vegetation"), ("lst", "land surface"),
                                                          ("no2", "nitrogen"), ("precip", "precip"),
                                                          ("station_temp", "station")] if n in lab), None)
    if v:
        out["variable"] = VAR_NOTES[v]
    return out


KEEP = ["title", "kind", "variable_label", "units", "source", "frequency", "method", "record_years", "n_valid",
        "slope_per_year", "slope_ci95", "slope_per_decade", "total_change", "percent_change", "p", "q",
        "verdict", "verdict_text", "signal_to_noise", "noise_sigma_annual", "years_to_detect",
        "min_detectable_slope", "change_point", "linear_ttest", "definition", "pixels_used", "pixels_total",
        "multiple_testing", "dummy"]


def compact(ctx):
    if ctx is None:
        return None
    out = {k: ctx.get(k) for k in KEEP if k in ctx}
    c = ctx.get("cleaning") or {}
    if c:
        raw = c.get("raw_values") or 1
        out["cleaning"] = {
            "share_removed_missing_or_cloud": round(c.get("removed_fill_or_missing", 0) / raw, 3),
            "share_removed_impossible": round(c.get("removed_out_of_range", 0) / raw, 4),
            "share_removed_spikes": round(c.get("removed_spikes", 0) / raw, 4),
            "final_missing_fraction": c.get("final_missing_fraction"),
        }
        if c.get("cutoff"):
            out["cleaning"]["record_cut_after"] = c["cutoff"]
            out["cleaning"]["cut_reason"] = c.get("cutoff_reason", "")
    return out


def explain(context, question=None, compare=None, lang="en", history=None):
    payload = {"CONTEXT": compact(context), "PLACE_NOTES": place_notes(context)}
    if compare:
        payload["COMPARE_WITH"] = compact(compare)
        payload["PLACE_NOTES_COMPARE"] = place_notes(compare)
    q = question or ("What does this result mean?" if not compare else
                     "What is the key difference between these two places?")
    q = QUESTION_BRIEFS.get(q, q)
    if not os.getenv("OPENROUTER_API_KEY"):
        return {"answer": template(context, compare, lang), "source": "template (no OPENROUTER_API_KEY in .env)"}
    msgs = []
    for turn in (history or [])[-6:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            msgs.append({"role": turn["role"], "content": turn["content"]})
    msgs.append({"role": "user",
                 "content": f"{json.dumps(payload, ensure_ascii=False, default=str)}\n\nQuestion: {q}"})
    system = SYSTEM.format(lang_name="Arabic" if lang == "ar" else "English")
    reason = "no free model configured"
    for model in models():
        t0 = time.time()
        try:
            text = call_openrouter(model, system, msgs)
            print(f"[Kemet] {model}: answered in {time.time() - t0:.1f} s", flush=True)
            if text:
                return {"answer": text, "source": f"{model} (OpenRouter, free)"}
            reason = "empty answer"
        except Exception as e:
            reason = "rate limit reached, try again in a minute" if "429" in str(e) else \
                     "the free model was too slow" if "timed out" in str(e).lower() else type(e).__name__
            print(f"[Kemet] {model}: failed after {time.time() - t0:.1f} s ({reason}: {str(e)[:120]})", flush=True)
    return {"answer": template(context, compare, lang), "source": f"template (OpenRouter unavailable: {reason})"}


def _fmt(x, nd=3):
    if x is None:
        return "–"
    return f"{x:+.{nd}g}"


AR_VERDICT = {
    "significant_increase": "زيادة ذات دلالة إحصائية (دليل قوي بعد التصحيح للاختبارات المتعددة).",
    "significant_decrease": "انخفاض ذو دلالة إحصائية (دليل قوي بعد التصحيح للاختبارات المتعددة).",
    "possible_increase": "مؤشر على زيادة محتملة، لكنها غير مؤكدة إحصائيًا بعد.",
    "possible_decrease": "مؤشر على انخفاض محتمل، لكنه غير مؤكد إحصائيًا بعد.",
    "no_significant_trend": "لا يوجد اتجاه ذو دلالة إحصائية؛ وهذا لا يعني بالضرورة عدم وجود تغير.",
    "insufficient_data": "البيانات غير كافية للحكم.",
}


def _cut_note(ctx, lang):
    c = (ctx or {}).get("cleaning") or {}
    if not c.get("cutoff"):
        return ""
    if lang == "ar":
        return (f" \u2068ملاحظة: السجل يتوقف عند {c['cutoff']}\u2069 لأن القمر الصناعي Terra انحرف مداره منذ 2020 "
                "وأصبح يمر في وقت أبكر من الصباح، فتظهر الحرارة أبرد بشكل زائف بعد ذلك.")
    return f" Note: the record stops at {c['cutoff']}. {c.get('cutoff_reason', '')}"


def template(ctx, compare=None, lang="en"):
    if ctx is None:
        return "Select a region, click a grid cell or draw a box to get an explanation."
    u = ctx.get("units", "").replace(" (unitless)", "")
    lo, hi = ctx.get("slope_ci95") or [None, None]
    dec = ctx.get("slope_per_decade")
    cp = ctx.get("change_point") or {}
    if lang == "ar":
        v = AR_VERDICT.get(ctx.get("verdict"), "")
        iso = lambda x: f"\u2068{x}\u2069"
        s = (f"{iso(ctx['variable_label'])} في «{iso(ctx['title'])}»: {v} "
             f"المعدل {_fmt(dec)} {u} لكل عقد (نطاق 95%: {_fmt(lo * 10 if lo is not None else None)} "
             f"إلى {_fmt(hi * 10 if hi is not None else None)}).")
        if cp.get("significant"):
            s += f" حدث تغير مفاجئ في {cp['date']} بمقدار {_fmt(cp['shift'])} {u}."
        if ctx.get("dummy"):
            s += " ملاحظة: هذه بيانات تجريبية للعرض فقط."
        return s + _cut_note(ctx, lang)
    s = (f"{ctx['variable_label']} in {ctx['title']}: {ctx.get('verdict_text', '')} "
         f"Rate: {_fmt(dec)} {u} per decade (95% range {_fmt(lo * 10 if lo is not None else None)} "
         f"to {_fmt(hi * 10 if hi is not None else None)}), about {_fmt(ctx.get('total_change'))} {u} "
         f"over {ctx.get('record_years')} years.")
    if cp.get("significant"):
        s += (f" There was a sudden jump in {cp['date']} of {_fmt(cp['shift'])} {u}; excluding it the trend is "
              f"{_fmt(cp['slope_excluding_jump'] * 10)} {u} per decade.")
    if compare:
        s += f" Compared with {compare['title']}: {compare.get('verdict_text', '')}"
    if ctx.get("dummy"):
        s += " Note: this is demonstration data, not real measurements."
    return s + _cut_note(ctx, lang)
