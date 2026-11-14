"""
Read the project's .env file without any extra package.

Why not python-dotenv: on Windows the common failures are silent - the package is not
installed in the environment uv/pip actually runs, Notepad saves the file as ".env.txt"
or with an invisible BOM before the first key, or the variable already exists empty in
the shell so it is never overridden. This loader handles all of those and prints one
line at startup saying what it found.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # the terrapulse folder


def _candidates():
    for folder in (ROOT, Path.cwd()):
        for name in (".env", ".env.txt", "env"):
            p = folder / name
            if p.is_file():
                yield p


def load_env():
    """Load KEY=value lines into os.environ (file wins over an empty shell value). Returns the file used."""
    for path in _candidates():
        text = path.read_text(encoding="utf-8-sig", errors="replace")    # utf-8-sig drops a BOM
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.lower().startswith("export "):
                line = line[7:]
            key, value = line.split("=", 1)
            key = key.strip().lstrip("﻿")
            value = value.split(" #", 1)[0].strip().strip('"').strip("'")
            if value and not os.environ.get(key):
                os.environ[key] = value
        return path
    return None


def report(var="OPENROUTER_API_KEY"):
    path = load_env()
    key = os.environ.get(var, "")
    where = f"from {path}" if path else f"no .env file found in {ROOT}"
    if key:
        print(f"[TerraPulse] {var} loaded ({key[:8]}...{key[-4:]}) {where}")
    else:
        hint = ("" if path else
                " Create a file named exactly .env (not .env.txt) next to README.md.")
        print(f"[TerraPulse] {var} NOT set ({where}). The explainer will use template answers.{hint}")
    return bool(key)
