import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _candidates():
    for folder in (ROOT, Path.cwd()):
        for name in (".env", ".env.txt", "env"):
            p = folder / name
            if p.is_file():
                yield p


def load_env():
    for path in _candidates():
        text = path.read_text(encoding="utf-8-sig", errors="replace")
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
