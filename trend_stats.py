import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy.stats import norm

Z95 = norm.ppf(0.975)


def _to_matrix(values, times, period):
    t = pd.DatetimeIndex(times)
    season = (t.month - 1) // (12 // period)
    year = t.year - t.year.min()
    X = np.full((year.max() + 1, period), np.nan)
    X[year, season] = values
    return X


def _ranks_with_missing(col):
    ok = ~np.isnan(col)
    n_g = ok.sum()
    R = np.full(col.shape, (n_g + 1) / 2.0)
    v = col[ok]
    R[ok] = (n_g + 1 + np.sign(v[:, None] - v[None, :]).sum(1)) / 2.0
    return R, n_g


def _sgn_pairs(col):
    d = np.sign(col[None, :] - col[:, None])
    return np.nan_to_num(np.triu(d, 1))


def _var_s_ties(col):
    v = col[~np.isnan(col)]
    n = len(v)
    _, counts = np.unique(v, return_counts=True)
    ties = np.sum(counts * (counts - 1) * (2 * counts + 5))
    return (n * (n - 1) * (2 * n + 5) - ties) / 18.0


def seasonal_mk_hirsch_slack(X):
    n, p = X.shape
    sg = [_sgn_pairs(X[:, g]) for g in range(p)]
    S = sum(m.sum() for m in sg)
    ranks = [_ranks_with_missing(X[:, g]) for g in range(p)]
    cov = np.zeros((p, p))
    for g in range(p):
        cov[g, g] = _var_s_ties(X[:, g])
        for h in range(g):
            K = np.sum(sg[g] * sg[h])
            (Rg, ng), (Rh, nh) = ranks[g], ranks[h]
            cov[g, h] = cov[h, g] = (K + 4 * np.sum(Rg * Rh) - n * (ng + 1) * (nh + 1)) / 3.0
    var_S = max(cov.sum(), 1e-12)
    z = (S - np.sign(S)) / np.sqrt(var_S)
    return S, var_S, z, 2 * (1 - norm.cdf(abs(z)))


def seasonal_sen_ci(X, var_S):
    slopes = []
    for g in range(X.shape[1]):
        col = X[:, g]
        i, j = np.triu_indices(len(col), 1)
        d = (col[j] - col[i]) / (j - i)
        slopes.append(d[~np.isnan(d)])
    s = np.sort(np.concatenate(slopes))
    N = len(s)
    C = Z95 * np.sqrt(var_S)
    lo = int(np.clip(np.floor((N - C) / 2), 0, N - 1))
    hi = int(np.clip(np.ceil((N + C) / 2), 0, N - 1))
    return float(np.median(s)), float(s[lo]), float(s[hi])


def sen_ci(y, var_S):
    i, j = np.triu_indices(len(y), 1)
    d = (y[j] - y[i]) / (j - i)
    s = np.sort(d[~np.isnan(d)])
    N = len(s)
    C = Z95 * np.sqrt(var_S)
    lo = int(np.clip(np.floor((N - C) / 2), 0, N - 1))
    hi = int(np.clip(np.ceil((N + C) / 2), 0, N - 1))
    return float(np.median(s)), float(s[lo]), float(s[hi])


def pettitt(resid, times):
    ok = ~np.isnan(resid)
    x, t = resid[ok], pd.DatetimeIndex(times)[ok]
    n = len(x)
    if n < 20:
        return None
    sgn = np.sign(x[None, :] - x[:, None])
    U = np.array([sgn[:k + 1, k + 1:].sum() for k in range(n - 1)])
    k = int(np.argmax(np.abs(U)))
    K = abs(U[k])
    seg = x.copy()
    seg[:k + 1] -= np.median(x[:k + 1])
    seg[k + 1:] -= np.median(x[k + 1:])
    r1 = np.corrcoef(seg[:-1], seg[1:])[0, 1]
    f = (1 + r1) / (1 - r1) if r1 > 0 else 1.0
    p = min(1.0, 2 * np.exp(-6 * K**2 / ((n**3 + n**2) * f)))
    return {"date": str(t[k + 1].date())[:7], "p": float(p),
            "shift": float(np.median(x[k + 1:]) - np.median(x[:k + 1]))}


def step_change(anom, times, min_seg_years=2, bic_threshold=10.0):
    t = pd.DatetimeIndex(times)
    ok = ~np.isnan(anom)
    y = anom[ok]
    tt = ((t - t[0]).days.values / 365.25)[ok]
    n = len(y)
    m = int(min_seg_years * 12 * n / len(anom))
    if n < 3 * m or n < 30:
        return None
    X0 = np.column_stack([np.ones(n), tt])
    b0, rss0 = np.linalg.lstsq(X0, y, rcond=None)[:2]
    rss0 = float(rss0[0]) if len(rss0) else float(np.sum((y - X0 @ b0) ** 2))
    best = (np.inf, None, None)
    for k in range(m, n - m):
        X1 = np.column_stack([X0, (np.arange(n) >= k).astype(float)])
        coef = np.linalg.lstsq(X1, y, rcond=None)[0]
        rss = float(np.sum((y - X1 @ coef) ** 2))
        if rss < best[0]:
            best = (rss, k, coef)
    rss1, k, coef = best
    res1 = y - np.column_stack([X0, (np.arange(n) >= k)]) @ coef
    r1 = float(np.clip(np.corrcoef(res1[:-1], res1[1:])[0, 1], 0, 0.95))
    n_eff = n * (1 - r1) / (1 + r1)
    dbic = n_eff * np.log(rss0 / rss1) - 2 * np.log(n_eff)
    years_after = float((t[ok][-1] - t[ok][k]).days / 365.25)
    return {"date": str(t[ok][k].date())[:7], "shift": float(coef[2]),
            "delta_bic": float(dbic), "significant": bool(dbic > bic_threshold),
            "slope_excluding_jump": float(coef[1]),
            "years_after": round(years_after, 1),
            "recent": bool(years_after < 4)}


def analyze_series(values, times, freq="monthly", percent_change=False, alpha=0.05):
    values = np.asarray(values, dtype=float)
    t = pd.DatetimeIndex(times)
    n_valid = int(np.sum(~np.isnan(values)))
    years = (t[-1] - t[0]).days / 365.25 + (1 / {"monthly": 12, "quarterly": 4, "yearly": 1}[freq])
    period = {"monthly": 12, "quarterly": 4}.get(freq)

    if period:
        X = _to_matrix(values, t, period)
        S, var_S, z, p = seasonal_mk_hirsch_slack(X)
        slope, lo, hi = seasonal_sen_ci(X, var_S)
        method = f"Seasonal Mann-Kendall (Hirsch-Slack), period={period}"
        clim = np.nanmedian(X, axis=0)
        season = (t.month - 1) // (12 // period)
        anom = values - clim[season]
    else:
        r = mk.hamed_rao_modification_test(values)
        S, var_S, z, p = r.s, r.var_s, r.z, r.p
        slope, lo, hi = sen_ci(values, var_S)
        method = "Mann-Kendall, Hamed-Rao autocorrelation correction"
        anom = values - np.nanmedian(values)

    yrs_from_start = (t - t[0]).days.values / 365.25
    resid = anom - slope * (yrs_from_start - np.nanmean(yrs_from_start[~np.isnan(anom)]))
    resid = resid - np.nanmean(resid)

    cp = step_change(anom, t)
    if cp and cp["significant"]:
        after = t >= pd.Timestamp(cp["date"] + "-01")
        resid = anom - cp["slope_excluding_jump"] * yrs_from_start - np.where(after, cp["shift"], 0.0)
        resid = resid - np.nanmean(resid)

    sigma = float(np.nanstd(resid))
    rr = resid[~np.isnan(resid)]
    phi = float(np.clip(np.corrcoef(rr[:-1], rr[1:])[0, 1], 0, 0.95)) if len(rr) > 3 else 0.0
    steps_per_year = {"monthly": 12, "quarterly": 4, "yearly": 1}[freq]
    sigma_annual = float(np.nanstd(pd.Series(resid, index=t).groupby(t.year).mean()))

    sig_eff = sigma * np.sqrt(12 / steps_per_year)
    infl = np.sqrt((1 + phi) / (1 - phi))
    years_to_detect = float((3.3 * sig_eff / abs(slope) * infl) ** (2 / 3)) if slope != 0 else np.inf
    min_detectable = float(3.3 * sig_eff * infl / years**1.5)

    ols = None
    ok = ~np.isnan(anom)
    if ok.sum() > 10:
        from scipy import stats as _st
        lr = _st.linregress(yrs_from_start[ok], anom[ok])
        res_ = anom[ok] - (lr.intercept + lr.slope * yrs_from_start[ok])
        r1 = float(np.clip(np.corrcoef(res_[:-1], res_[1:])[0, 1], 0, 0.95)) if ok.sum() > 3 else 0.0
        n = int(ok.sum())
        n_eff = max(3.0, n * (1 - r1) / (1 + r1))
        se_adj = lr.stderr * np.sqrt((n - 2) / max(n_eff - 2, 1))
        t_adj = lr.slope / se_adj if se_adj > 0 else 0.0
        p_adj = float(2 * _st.t.sf(abs(t_adj), df=max(n_eff - 2, 1)))
        ols = {"slope_per_year": float(lr.slope), "p_naive": float(lr.pvalue), "p_adjusted": p_adj,
               "ci95": [float(lr.slope - 1.96 * se_adj), float(lr.slope + 1.96 * se_adj)],
               "n": n, "n_effective": round(n_eff, 1), "lag1_autocorr": round(r1, 2)}

    total = slope * years
    if cp and cp["significant"]:
        total = cp["slope_excluding_jump"] * years + cp["shift"]
    first = values[yrs_from_start < 5]
    base = float(np.nanmean(first)) if np.any(~np.isnan(first)) else np.nan
    out = {
        "method": method, "n_valid": n_valid, "record_years": round(years, 1),
        "S": float(S), "z": float(z), "p": float(p),
        "slope_per_year": slope, "slope_ci95": [lo, hi],
        "slope_per_decade": slope * 10,
        "total_change": total,
        "percent_change": (100 * total / abs(base)) if (percent_change and base and abs(base) > 1e-9) else None,
        "noise_sigma_annual": sigma_annual,
        "signal_to_noise": abs(total) / sigma_annual if sigma_annual > 0 else None,
        "lag1_autocorr": phi,
        "years_to_detect": years_to_detect,
        "min_detectable_slope": min_detectable,
        "change_point": cp,
        "linear_ttest": ols,
    }
    return out


def fdr_bh(pvals):
    p = np.asarray(pvals, dtype=float)
    q = np.full_like(p, np.nan)
    ok = ~np.isnan(p)
    pv = p[ok]
    m = len(pv)
    if m == 0:
        return q
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qq = np.empty(m)
    qq[order] = np.minimum(ranked, 1.0)
    q[ok] = qq
    return q


def verdict(res, q, alpha=0.05, status="ok", min_meaningful=None):
    if status != "ok":
        return "insufficient_data", f"Not analysed: {status.replace('_', ' ')}."
    total = res.get("total_change")
    if q < alpha and min_meaningful and total is not None and abs(total) < min_meaningful:
        return "significant_but_small", (f"A real but tiny change: statistically detectable (q={q:.3f}), but the total "
                                         f"change ({total:+.3g}) is smaller than {min_meaningful:g}, the smallest change "
                                         f"that matters for this measurement. Significant is not the same as important.")
    if q < alpha:
        d = "increase" if res["slope_per_year"] > 0 else "decrease"
        qs = "q<0.001" if q < 0.001 else f"q={q:.3f}"
        return f"significant_{d}", f"Significant {d} ({qs} after correcting for multiple tests)."
    if res["p"] < alpha:
        d = "increase" if res["slope_per_year"] > 0 else "decrease"
        return f"possible_{d}", (f"Possible {d}: significant on its own (p={res['p']:.3f}) but not after "
                                 f"correcting for testing many places at once. At this rate about "
                                 f"{res['years_to_detect']:.0f} years of data would be needed to confirm it; "
                                 f"we have {res['record_years']:.0f}.")
    return "no_significant_trend", (f"No significant trend. Any trend larger than about "
                                    f"{res['min_detectable_slope']:.3g} per year would very likely have been "
                                    f"detected. Not significant does not prove 'no change'.")
