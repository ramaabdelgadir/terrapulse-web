"""
STEP 5 - The service layer: turns pipeline results into what the website needs.

Precomputed (fast):  pixel layers and region results from data/results/
Live (still fast):   analysis of any box the user draws, or any pixel clicked
"""
import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config as C                                    # noqa: E402
from trend_stats import analyze_series, verdict       # noqa: E402

IS_DUMMY = C.DUMMY_DATA   # shown on screen and told to the AI

# Colour meaning per variable: (decrease colour, increase colour, what each means)
SCHEMES = {
    "ndvi":        {"neg": "#8C5A24", "pos": "#2F7A4F", "neg_word": "browning", "pos_word": "greening"},
    "lst":         {"neg": "#2F6EA3", "pos": "#B8433A", "neg_word": "cooling", "pos_word": "warming"},
    "cairo_t2m":   {"neg": "#2F6EA3", "pos": "#B8433A", "neg_word": "cooling", "pos_word": "warming"},
    "precip":      {"neg": "#A86F1F", "pos": "#1A78A0", "neg_word": "drying", "pos_word": "wetting"},
    "groundwater": {"neg": "#A86F1F", "pos": "#1A78A0", "neg_word": "losing water", "pos_word": "gaining water"},
    "no2":         {"neg": "#2F7A6E", "pos": "#8A4B2A", "neg_word": "cleaner air", "pos_word": "more pollution"},
    "station_temp": {"neg": "#2F6EA3", "pos": "#B8433A", "neg_word": "cooling", "pos_word": "warming"},
    "et":          {"neg": "#A86F1F", "pos": "#1A78A0", "neg_word": "less evaporation", "pos_word": "more evaporation"},
}

# Plain-language definitions for students (the challenge asks for these).
DEFINITIONS = {
    "ndvi": "NDVI measures how green and leafy the land is, from satellite light readings. "
            "Near 0 is bare sand or city; about 0.3 is sparse plants; above 0.6 is dense, healthy crops.",
    "lst": "Land surface temperature is how hot the ground itself is in the daytime, seen by the satellite "
           "(not the air temperature a weather station measures). Cities and deserts get much hotter than fields.",
    "precip": "Precipitation is rain (and snow) reaching the ground, here as the average millimetres per day "
              "in each month, combining several satellites with rain gauges.",
    "no2": "Nitrogen dioxide (NO₂) is a gas from car exhausts, power plants and factories. The satellite measures "
           "how much is in the air column above the ground; more NO₂ usually means more polluted air.",
    "et": "Evapotranspiration is water going from the land into the air: evaporation from soil and water plus "
          "the water plants release through their leaves. In a rainforest it recycles much of the rain.",
    "groundwater": "Total water storage is all the water held on and under the land (soil, groundwater, lakes), "
                   "measured from tiny changes in Earth's gravity.",
    "cairo_t2m": "Air temperature 2 metres above the ground, like a normal weather thermometer.",
    "station_temp": "Air temperature measured by a real thermometer at a weather station, not a satellite. "
                    "We use it to check whether what the satellites show agrees with the ground.",
}


def _clean(o):
    """JSON-safe: NaN/inf -> None, numpy -> python."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


@lru_cache
def regions_file():
    return json.loads((C.RESULTS / "regions.json").read_text())


@lru_cache
def clean_ds(var):
    return xr.open_dataset(C.CLEAN / f"{var}.nc").load()


@lru_cache
def cleaning_report():
    return {r["variable"]: r for r in json.loads((C.CLEAN / "cleaning_report.json").read_text())}


def meta():
    variables = []
    rows = regions_file()
    for name, spec in C.VARIABLES.items():
        vrows = [r for r in rows if r["variable"] == name]
        if not vrows:                      # no results yet (e.g. data still downloading)
            continue
        variables.append({
            "id": name, "label": spec["label"], "units": spec["units"], "source": spec["source"],
            "frequency": vrows[0]["frequency"],
            "gridded": (C.RESULTS / f"pixels_{name}.nc").exists(),
            "point": [spec.get("lat"), spec.get("lon")] if spec["kind"] == "point_csv" else None,
            "regions_avail": [r["region"] for r in vrows],
            "definition": DEFINITIONS.get(name, ""),
            **SCHEMES.get(name, SCHEMES["ndvi"]),
        })
    return {"dummy": IS_DUMMY, "variables": variables,
            "regions": [{"id": k, **v} for k, v in C.REGIONS.items()]}


def pixels(var):
    px = xr.open_dataset(C.RESULTS / f"pixels_{var}.nc")
    dlat = float(np.diff(px.lat.values).mean())
    dlon = float(np.diff(px.lon.values).mean())
    cells = []
    for i, la in enumerate(px.lat.values):
        for j, lo in enumerate(px.lon.values):
            cells.append({
                "lat": float(la), "lon": float(lo),
                "verdict": str(px.verdict.values[i, j]),
                "slope": px.slope_per_year.values[i, j],
                "ci": [px.ci_low.values[i, j], px.ci_high.values[i, j]],
                "q": px.q.values[i, j], "p": px.p.values[i, j],
                "percent": px.percent_change.values[i, j],
                "jump": str(px.cp_date.values[i, j]) or None,
            })
    slopes = px.slope_per_year.values[np.isfinite(px.slope_per_year.values)]
    vmax = float(np.percentile(np.abs(slopes), 95)) if len(slopes) else 1.0
    return _clean({"var": var, "dlat": dlat, "dlon": dlon, "slope_max": vmax, "cells": cells})


def chart_lines(years, annual, res):
    """Trend line (and 95% fan) through the annual means, Sen-style intercept."""
    yrs = np.asarray(years, dtype=float)
    a = np.array([np.nan if v is None else v for v in annual], dtype=float)
    ok = ~np.isnan(a)
    cp = res.get("change_point")
    x = yrs - yrs[0] + 0.5
    if cp and cp.get("significant"):
        jy = int(cp["date"][:4]) + (int(cp["date"][5:7]) - 1) / 12
        after = (yrs + 0.5) >= jy
        b, c = cp["slope_excluding_jump"], cp["shift"]
        base = np.nanmedian(a[ok] - b * x[ok] - c * after[ok])
        trend = base + b * x + c * after
        return {"trend": trend.tolist(), "jump_year": jy, "fan": None}
    b = res["slope_per_year"]
    base = np.nanmedian(a[ok] - b * x[ok])
    trend = base + b * x
    pivot = np.median(x[ok])
    yc = base + b * pivot
    lo, hi = res["slope_ci95"]
    return {"trend": trend.tolist(), "jump_year": None,
            "fan": [(yc + lo * (x - pivot)).tolist(), (yc + hi * (x - pivot)).tolist()]}


def _package(var, res, series_t, series_v, title, kind, extra=None):
    t = pd.DatetimeIndex(series_t)
    s = pd.Series(series_v, index=t)
    annual = s.groupby(t.year).mean()
    years = annual.index.tolist()
    vals = [None if np.isnan(v) else float(v) for v in annual.values]
    spec = C.VARIABLES[var]
    out = {
        "variable": var, "variable_label": spec["label"], "units": spec["units"],
        "source": spec["source"], "title": title, "kind": kind, **res,
        "annual": {"year": years, "value": vals},
        "series": {"time": [str(x.date()) for x in t],
                   "value": [None if np.isnan(v) else float(v) for v in s.values]},
        "lines": chart_lines(years, vals, res),
        "cleaning": cleaning_report().get(var), "dummy": IS_DUMMY,
        "definition": DEFINITIONS.get(var, ""),
    }
    if extra:
        out.update(extra)
    return _clean(out)


def region(var, region_id):
    r = next((x for x in regions_file() if x["variable"] == var and x["region"] == region_id), None)
    if r is None:
        return None
    t = r["series"]["time"]
    v = np.array([np.nan if x is None else x for x in r["series"]["value"]])
    res = {k: r[k] for k in r if k not in ("series", "annual", "cleaning")}
    return _package(var, res, t, v, r["region_label"], "region",
                    {"multiple_testing": "q-value corrected across all preset region tests"})


def analyze_box(var, box):
    """Live analysis of a user-drawn box (lat_min, lat_max, lon_min, lon_max)."""
    ds = clean_ds(var)
    la0, la1, lo0, lo1 = box
    sub = ds.sel(lat=slice(la0, la1), lon=slice(lo0, lo1))
    n_ok = int((sub.status == "ok").sum())
    if n_ok == 0:
        return {"error": "This box has no usable grid cells for this variable. Draw a box over the data area."}
    v = sub.value.where(sub.status == "ok")
    w = np.cos(np.deg2rad(sub.lat))
    mean = v.weighted(w).mean(("lat", "lon")).where(v.notnull().mean(("lat", "lon")) >= 0.5)
    spec = C.VARIABLES[var]
    res = analyze_series(mean.values, mean.time.values, ds.attrs["frequency"], spec["percent_change"])
    # A single user-chosen box is one test -> q = p, and we say so.
    res["q"] = res["p"]
    res["verdict"], res["verdict_text"] = verdict(res, res["q"], C.ALPHA, min_meaningful=spec.get("min_meaningful"))
    res.update(pixels_used=n_ok, pixels_total=int(sub.status.size), box=list(box), frequency=ds.attrs["frequency"])
    title = f"Your box ({la0:.2f}–{la1:.2f}°N, {lo0:.2f}–{lo1:.2f}°E)"
    return _package(var, res, mean.time.values, mean.values, title, "box",
                    {"multiple_testing": "single user-drawn box: not corrected for multiple tests"})


def analyze_pixel(var, lat, lon):
    ds = clean_ds(var)
    cell = ds.sel(lat=lat, lon=lon, method="nearest")
    la, lo = float(cell.lat), float(cell.lon)
    if str(cell.status.values) != "ok":
        return {"error": f"This cell was not analysed: {str(cell.status.values).replace('_', ' ')}."}
    spec = C.VARIABLES[var]
    res = analyze_series(cell.value.values, cell.time.values, ds.attrs["frequency"], spec["percent_change"])
    px = xr.open_dataset(C.RESULTS / f"pixels_{var}.nc").sel(lat=la, lon=lo)
    res["q"] = float(px.q)                                  # FDR-corrected across the map
    res["verdict"], res["verdict_text"] = verdict(res, res["q"], C.ALPHA, min_meaningful=spec.get("min_meaningful"))
    res.update(pixels_used=1, pixels_total=1, frequency=ds.attrs["frequency"])
    return _package(var, res, cell.time.values, cell.value.values,
                    f"Grid cell at {la:.2f}°N, {lo:.2f}°E", "pixel",
                    {"multiple_testing": "q-value corrected across all grid cells of the map"})


@lru_cache
def validation():
    p = C.RESULTS / "validation.json"
    return json.loads(p.read_text()) if p.exists() else None
