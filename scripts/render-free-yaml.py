#!/usr/bin/env python3
"""Regenerate render.free.yaml (the no-card bootstrap Blueprint) from render.yaml. Usage: python3 scripts/render-free-yaml.py [--check]"""
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
HEADER = (ROOT / "render.free.yaml").read_text().split("\n\n", 1)[0] + "\n"


def build() -> str:
    d = yaml.safe_load((ROOT / "render.yaml").read_text())
    d["databases"][0]["plan"] = "free"
    d["databases"][0].pop("diskSizeGB", None)
    web = [s for s in d["services"] if s["type"] == "web"]
    web[0]["plan"] = "free"
    web[0].pop("maxShutdownDelaySeconds", None)
    web[0]["envVars"] = [e for e in web[0]["envVars"] if e.get("key") != "NEIGHBORLINE_WORKFLOWS"]  # no Workflows here  # Render: "max shutdown delay is not supported for free tier services"
    d["services"] = web
    return HEADER + "\n" + yaml.safe_dump(d, sort_keys=False, width=200)


if __name__ == "__main__":
    out = build()
    target = ROOT / "render.free.yaml"
    if "--check" in sys.argv:
        sys.exit(0 if target.read_text() == out else "render.free.yaml is stale: python3 scripts/render-free-yaml.py")
    target.write_text(out)
