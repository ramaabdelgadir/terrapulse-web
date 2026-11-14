import os
from pathlib import Path

ROOT = Path(__file__).parent

DUMMY_DATA = os.getenv("TERRAPULSE_DATA", "real") != "real"

RAW = ROOT / "data" / ("raw" if DUMMY_DATA else "raw_real")
CLEAN = ROOT / "data" / "clean"
RESULTS = ROOT / "data" / "results"

TARGET_FREQ = "auto"
AUTO_LIMITS = {
    "monthly": 20_000_000,
    "quarterly": 60_000_000,
}
MAX_MISSING_FRAC = 0.30
MIN_YEARS = 10
MIN_VALID_IN_PERIOD = {
    "quarterly": 2,
    "yearly": 10,
}

ALPHA = 0.05

DUMMY_REGIONS = {
    "nile_delta":    dict(box=(29.5, 31.5, 29.5, 32.5), label="Whole Nile Delta box"),
    "new_delta":     dict(box=(30.0, 30.75, 29.5, 30.25), label="New Delta (west, desert reclamation)"),
    "greater_cairo": dict(box=(29.75, 30.5, 31.0, 31.5), label="Greater Cairo & southern Delta"),
    "north_coast":   dict(box=(31.25, 31.5, 29.5, 32.5), label="Mediterranean coast"),
}
REAL_REGIONS = {
    "nile_delta":    dict(box=(29.5, 31.6, 29.5, 32.5), label="Whole Nile Delta box"),
    "new_delta":     dict(box=(30.3, 30.9, 29.6, 30.4), label="New Delta (west, desert reclamation)"),
    "greater_cairo": dict(box=(29.85, 30.25, 31.05, 31.55), label="Greater Cairo"),
    "north_coast":   dict(box=(31.0, 31.6, 29.5, 32.5), label="Mediterranean coast (Alexandria)"),
    "amazon":        dict(box=(-6.0, 0.0, -63.0, -57.0), label="Central Amazon (around Manaus)"),
    "alexandria":    dict(box=(31.13, 31.23, 29.90, 30.00), label="Alexandria (around the airport weather station)"),
}

CONVERT = {
    None: lambda x: x,
    "K_to_C": lambda x: x - 273.15,
    "mm_hr_to_mm_day": lambda x: x * 24.0,
    "kg_m2_s_to_mm_day": lambda x: x * 86400.0,
    "to_1e15": lambda x: x / 1e15,
}

DUMMY_VARIABLES = {
    "ndvi": dict(
        percent_change=True,
        kind="grid", file="dummy_MOD13_ndvi.nc", var="NDVI",
        fill=-3000, scale=0.0001, convert=None, units="NDVI (unitless)",
        valid=(-0.2, 1.0), outlier_z=6.0,
        label="Vegetation greenness (NDVI)", source="MODIS MOD13 (dummy)",
    ),
    "lst": dict(
        percent_change=False,
        kind="grid", file="dummy_MOD11_lst.nc", var="LST_Day",
        fill=0, scale=0.02, convert="K_to_C", units="°C",
        valid=(-10.0, 75.0), outlier_z=6.0,
        label="Daytime land surface temperature", source="MODIS MOD11 (dummy)",
    ),
    "precip": dict(
        percent_change=True,
        kind="grid", file="dummy_IMERG_precip.nc", var="precipitation",
        fill=-9999.9, scale=1.0, convert="mm_hr_to_mm_day", units="mm/day",
        valid=(0.0, 200.0), outlier_z=None,
        label="Precipitation", source="GPM IMERG (dummy)",
    ),
    "groundwater": dict(
        percent_change=False,
        kind="grid", file="dummy_GRACE_lwe.nc", var="lwe_thickness",
        fill=-99999.0, scale=1.0, convert=None, units="cm water",
        valid=(-100.0, 100.0), outlier_z=6.0,
        label="Total water storage anomaly", source="GRACE/GRACE-FO (dummy)",
    ),
    "cairo_t2m": dict(
        percent_change=False,
        kind="point_csv", file="dummy_POWER_cairo_daily.csv", var="T2M",
        fill=-999, scale=1.0, convert=None, units="°C",
        valid=(-10.0, 55.0), outlier_z=6.0, lat=30.0444, lon=31.2357,
        label="Air temperature at 2 m (Cairo)", source="NASA POWER (dummy)",
    ),
}


REAL_VARIABLES = {
    "ndvi": dict(
        kind="grid", file="MOD13A3*.nc", var="_1_km_monthly_NDVI",
        fill=-3000, scale=0.0001, convert=None, units="NDVI (unitless)", percent_change=True,
        valid=(-0.2, 1.0), outlier_z=6.0, coarsen=6,
        min_meaningful=0.02,
        qc=dict(var="_1_km_monthly_pixel_reliability", keep=[0, 1]),
        label="Vegetation greenness (NDVI)", source="NASA MODIS Terra MOD13A3 v061 via AppEEARS",
    ),
    "lst": dict(
        kind="grid", file="MOD11A2*.nc", var="LST_Day_1km",
        fill=0, scale=0.02, convert="K_to_C", units="°C", percent_change=False,
        valid=(-10.0, 75.0), outlier_z=6.0, coarsen=6,
        min_meaningful=0.5,
        end="2021-12",
        end_reason=("Terra stopped orbit corrections in Feb 2020 and now passes earlier in the morning, "
                    "so daytime LST reads cooler every year (about -0.4 °C in 2022 growing to -6 °C in 2026 "
                    "over the Delta). Data after 2021 would show a fake cooling trend, so it is cut."),
        qc=dict(var="QC_Day", bits=(0, 1), keep=[0, 1]),
        label="Daytime land surface temperature", source="NASA MODIS Terra MOD11A2 v061 via AppEEARS",
    ),
    "precip": dict(
        kind="region_series", files={"nile_delta": "giovanni_precip_nile_delta.csv",
                                     "north_coast": "giovanni_precip_north_coast.csv",
                                     "amazon": "giovanni_precip_amazon.csv"},
        fill=-9999, scale=1.0, convert=None, units="mm/day", percent_change=True,
        valid=(0.0, 200.0), outlier_z=None,
        label="Precipitation", source="NASA GPM IMERG Final monthly v07 via Giovanni",
    ),
    "no2": dict(
        kind="region_series", files={"greater_cairo": "giovanni_no2_greater_cairo.csv",
                                     "nile_delta": "giovanni_no2_nile_delta.csv"},
        fill=-9999, scale=1.0, convert=None, units="10¹⁵ molecules/cm²", percent_change=True,
        valid=(-5.0, 100.0), outlier_z=6.0, min_obs=10,
        label="Nitrogen dioxide (air pollution)", source="NASA Aura OMI OMNO2d v004 via Giovanni",
    ),
    "station_temp": dict(
        kind="region_series", files={"alexandria": "ghcn_alexandria_temp.csv"},
        fill=-9999, scale=1.0, convert=None, units="°C", percent_change=False,
        valid=(-10.0, 50.0), outlier_z=6.0, min_obs=20,
        label="Air temperature at a weather station (ground truth)",
        source="NOAA GHCN-Daily, Alexandria International (EGM00062318)",
    ),
}

VARIABLES = DUMMY_VARIABLES if DUMMY_DATA else REAL_VARIABLES
REGIONS = DUMMY_REGIONS if DUMMY_DATA else REAL_REGIONS
