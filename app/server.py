"""
TerraPulse local web server.

Run from the project folder:
    uvicorn app.server:app --reload --port 8000
then open http://localhost:8000
"""
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import service as S
from .explainer import explain

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="TerraPulse")


@app.get("/api/meta")
def meta():
    return S.meta()


@app.get("/api/pixels/{var}")
def pixels(var: str):
    try:
        return S.pixels(var)
    except FileNotFoundError:
        raise HTTPException(404, f"No pixel map for '{var}' (point variables have no map).")


@app.get("/api/region/{var}/{region}")
def region(var: str, region: str):
    r = S.region(var, region)
    if r is None:
        raise HTTPException(404, "No result for this variable and region.")
    return r


class Box(BaseModel):
    var: str
    box: list[float]          # lat_min, lat_max, lon_min, lon_max


@app.post("/api/analyze_box")
def analyze_box(b: Box):
    return S.analyze_box(b.var, b.box)


@app.get("/api/pixel/{var}")
def pixel(var: str, lat: float, lon: float):
    return S.analyze_pixel(var, lat, lon)


@app.get("/api/trust/{var}")
def trust(var: str):
    return S._clean({"cleaning": S.cleaning_report().get(var), "validation": S.validation()})


class Ask(BaseModel):
    context: Optional[dict] = None
    compare: Optional[dict] = None
    question: Optional[str] = None
    lang: str = "en"
    history: Optional[list[dict]] = None


@app.post("/api/explain")
def ask(a: Ask):
    return explain(a.context, a.question, a.compare, a.lang, a.history)


app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/figures", StaticFiles(directory=Path(__file__).parents[1] / "figures"), name="figures")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
