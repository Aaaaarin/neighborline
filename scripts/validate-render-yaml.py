#!/usr/bin/env python3
"""Validate render.yaml.

1. If https://render.com/schema/render.yaml.json is reachable (and `jsonschema` is installed), validate
   against Render's official JSON Schema.
2. Always run the rule checks below, transcribed from Render's Blueprint YAML reference
   (https://render.com/docs/blueprint-spec, Oct 2026), plus cross-reference checks the JSON Schema
   cannot do (fromService / fromDatabase / fromGroup targets exist, unique names, secrets not inline).

Usage: python3 scripts/validate-render-yaml.py [path/to/render.yaml]   (needs PyYAML)
Exit code 0 = valid. For an authoritative server-side check: `render blueprints validate render.yaml`.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

import yaml

SCHEMA_URL = "https://render.com/schema/render.yaml.json"
TOP_LEVEL = {"services", "databases", "envVarGroups", "projects", "ungrouped", "previews"}
SERVICE_TYPES = {"web", "pserv", "worker", "cron", "keyvalue", "redis", "workflow"}
RUNTIMES = {"node", "python", "ruby", "go", "elixir", "rust", "docker", "image", "static"}
REGIONS = {"oregon", "ohio", "virginia", "frankfurt", "singapore"}
SERVICE_PLANS = {
    "free", "0.5c-512mb", "1c-2g", "2c-4g", "2c-8g", "2c-16g", "4c-8g", "4c-16g", "4c-32g",
    "8c-16g", "8c-32g", "8c-64g", "12c-24g", "12c-48g", "12c-96g",
    # legacy names, still accepted (https://render.com/docs/compute-plans)
    "starter", "standard", "pro", "pro_plus", "pro_max", "pro_ultra",
}
DB_PLANS = {
    "free", "0.1c-256mb", "0.5c-1g", "1c-2g", "1c-4g", "2c-4g", "2c-8g", "2c-16g", "4c-16g", "4c-32g",
    "8c-32g", "8c-64g", "16c-64g", "16c-128g", "32c-128g", "32c-256g", "48c-192g", "48c-384g",
    "64c-256g", "64c-512g", "96c-384g", "96c-768g", "128c-512g", "128c-1024g",
    # legacy flexible-plan names
    "basic-256mb", "basic-1gb", "basic-4gb", "pro-4gb", "pro-8gb",
}
AUTO_DEPLOY = {"commit", "checksPass", "off"}
DB_PROPS = {"connectionString", "connectionPoolString", "host", "port", "user", "password", "database"}
SERVICE_PROPS = {"host", "port", "hostport", "connectionString", "slug"}
FROM_SERVICE_TYPES = {"web", "pserv", "worker", "cron", "keyvalue", "redis", "workflow"}
WORKFLOW_FORBIDDEN = {"plan", "preDeployCommand", "dockerCommand", "dockerfilePath", "dockerContext",
                      "registryCredential", "image", "previews", "numInstances", "scaling", "disk",
                      "healthCheckPath", "domains"}
SECRETISH = re.compile(r"(SECRET|PASSWORD|API_KEY|TOKEN|CLIENT_SECRET)$")

errors: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def try_official_schema(doc: dict) -> str:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return "skipped (pip install jsonschema to enable)"
    try:
        with urllib.request.urlopen(SCHEMA_URL, timeout=10) as r:
            schema = json.load(r)
    except Exception as e:  # network blocked / offline
        return f"skipped (could not fetch {SCHEMA_URL}: {e.__class__.__name__})"
    v = jsonschema.Draft7Validator(schema) if "draft-07" in str(schema.get("$schema", "")) else jsonschema.validators.validator_for(schema)(schema)
    problems = sorted(v.iter_errors(doc), key=lambda e: list(e.absolute_path))
    for p in problems:
        err("schema " + "/".join(map(str, p.absolute_path)), p.message)
    return f"official schema: {len(problems)} problem(s)"


def check_env_vars(where: str, env_vars: list, *, in_group: bool, names: dict) -> None:
    if not isinstance(env_vars, list):
        err(where, "envVars must be a list")
        return
    seen: set[str] = set()
    for i, ev in enumerate(env_vars):
        w = f"{where}.envVars[{i}]"
        if not isinstance(ev, dict):
            err(w, "must be a mapping")
            continue
        if "fromGroup" in ev:
            if in_group:
                err(w, "fromGroup is not allowed inside an env group")
            elif ev["fromGroup"] not in names["groups"]:
                err(w, f"fromGroup '{ev['fromGroup']}' is not defined in envVarGroups")
            if set(ev) - {"fromGroup"}:
                err(w, "fromGroup entries take no other keys")
            continue
        key = ev.get("key")
        if not isinstance(key, str) or not key:
            err(w, "missing key")
            continue
        if key in seen:
            err(w, f"duplicate key {key}")
        seen.add(key)
        sources = [k for k in ("value", "generateValue", "sync", "fromDatabase", "fromService") if k in ev]
        if len(sources) != 1:
            err(w, f"{key}: exactly one of value/generateValue/sync/fromDatabase/fromService required, got {sources}")
            continue
        src = sources[0]
        if in_group and src in {"sync", "fromDatabase", "fromService"}:
            err(w, f"{key}: {src} is not allowed in env groups")
        if src == "value":
            if not isinstance(ev["value"], (str, int, float, bool)):
                err(w, f"{key}: value must be a scalar")
            if SECRETISH.search(key) and str(ev["value"]).strip():
                err(w, f"{key}: looks like a secret; use sync: false or generateValue instead of an inline value")
        elif src == "generateValue" and ev["generateValue"] is not True:
            err(w, f"{key}: generateValue must be true")
        elif src == "sync" and ev["sync"] is not False:
            err(w, f"{key}: sync must be false")
        elif src == "fromDatabase":
            fd = ev["fromDatabase"]
            if fd.get("name") not in names["databases"]:
                err(w, f"{key}: fromDatabase name '{fd.get('name')}' is not defined")
            if fd.get("property") not in DB_PROPS:
                err(w, f"{key}: fromDatabase property must be one of {sorted(DB_PROPS)}")
        elif src == "fromService":
            fs = ev["fromService"]
            t, n = fs.get("type"), fs.get("name")
            if t not in FROM_SERVICE_TYPES:
                err(w, f"{key}: fromService type '{t}' invalid")
            if names["services"].get(n) != t and not (t in {"redis", "keyvalue"} and names["services"].get(n) in {"redis", "keyvalue"}):
                err(w, f"{key}: fromService {t}/{n} does not match a defined service")
            has_prop, has_key = "property" in fs, "envVarKey" in fs
            if has_prop == has_key:
                err(w, f"{key}: fromService needs exactly one of property / envVarKey")
            if has_prop and fs["property"] not in SERVICE_PROPS:
                err(w, f"{key}: fromService property must be one of {sorted(SERVICE_PROPS)}")
            if has_prop and fs["property"] == "slug" and t != "workflow":
                err(w, f"{key}: property slug is documented for workflow services")
            if has_prop and fs["property"] in {"host", "port", "hostport"} and t not in {"web", "pserv", "keyvalue", "redis"}:
                err(w, f"{key}: {t} services have no private-network address")


def check_service(s: dict, names: dict) -> None:
    name = s.get("name", "<unnamed>")
    w = f"services[{name}]"
    t = s.get("type")
    if t not in SERVICE_TYPES:
        err(w, f"type must be one of {sorted(SERVICE_TYPES)}")
        return
    runtime = s.get("runtime")
    if t not in {"keyvalue", "redis"}:
        if runtime not in RUNTIMES:
            err(w, f"runtime must be one of {sorted(RUNTIMES)}")
        if runtime not in {"docker", "image"} and not s.get("buildCommand") and runtime != "static":
            err(w, "buildCommand is required for native runtimes")
        if runtime != "static" and runtime not in {"docker", "image"} and not s.get("startCommand"):
            err(w, "startCommand is required")
    if "region" in s and s["region"] not in REGIONS:
        err(w, f"region must be one of {sorted(REGIONS)}")
    if t == "workflow":
        if runtime not in {"node", "python"}:
            err(w, "workflow runtime must be node or python")
        if "region" not in s:
            err(w, "workflow requires region")
        for k in WORKFLOW_FORBIDDEN & set(s):
            err(w, f"'{k}' is not supported on workflow services")
    else:
        plan = s.get("plan")
        if plan is not None and t not in {"keyvalue", "redis"} and plan not in SERVICE_PLANS:
            err(w, f"plan '{plan}' is not a documented compute plan")
        if plan == "free" and t not in {"web", "keyvalue", "redis"}:
            err(w, f"free instances are only for web services (and Postgres/Key Value), not {t}")
    if t == "cron":
        sched = s.get("schedule")
        if not isinstance(sched, str) or len(sched.split()) != 5:
            err(w, "cron requires a 5-field schedule string")
    elif "schedule" in s:
        err(w, "schedule is only valid for cron services")
    if "healthCheckPath" in s:
        if t != "web":
            err(w, "healthCheckPath is web-only")
        elif not str(s["healthCheckPath"]).startswith("/"):
            err(w, "healthCheckPath must start with /")
    if "autoDeployTrigger" in s and s["autoDeployTrigger"] not in AUTO_DEPLOY:
        err(w, f"autoDeployTrigger must be one of {sorted(AUTO_DEPLOY)}")
    if "autoDeploy" in s:
        err(w, "autoDeploy is deprecated; use autoDeployTrigger")
    if "env" in s:
        err(w, "env is deprecated; use runtime")
    msd = s.get("maxShutdownDelaySeconds")
    if msd is not None and not (isinstance(msd, int) and 1 <= msd <= 300):
        err(w, "maxShutdownDelaySeconds must be an integer 1-300")
    bf = s.get("buildFilter")
    if bf is not None:
        if not isinstance(bf, dict) or set(bf) - {"paths", "ignoredPaths"}:
            err(w, "buildFilter takes only paths / ignoredPaths")
        elif not ("paths" in bf and "ignoredPaths" in bf):
            err(w, "buildFilter: set both paths and ignoredPaths (a sync replaces the whole filter)")
    root = s.get("rootDir")
    if root is not None and (str(root).startswith("/") or ".." in str(root)):
        err(w, "rootDir must be a relative path inside the repo")
    check_env_vars(w, s.get("envVars", []), in_group=False, names=names)


def check_database(d: dict) -> None:
    w = f"databases[{d.get('name', '<unnamed>')}]"
    if not d.get("name"):
        err(w, "name is required")
    if "plan" in d and d["plan"] not in DB_PLANS:
        err(w, f"plan '{d['plan']}' is not a documented Postgres plan")
    if "region" in d and d["region"] not in REGIONS:
        err(w, "invalid region")
    pmv = d.get("postgresMajorVersion")
    if pmv is not None and not isinstance(pmv, str):
        err(w, "postgresMajorVersion must be a string, e.g. '17'")
    size = d.get("diskSizeGB")
    if size is not None and not (isinstance(size, int) and (size == 1 or (size > 0 and size % 5 == 0))):
        err(w, "diskSizeGB must be 1 or a multiple of 5")
    for i, rule in enumerate(d.get("ipAllowList", []) or []):
        if not isinstance(rule, dict) or "source" not in rule:
            err(f"{w}.ipAllowList[{i}]", "needs a source CIDR")


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "render.yaml")
    doc = yaml.safe_load(path.read_text())
    if not isinstance(doc, dict):
        print(f"{path}: not a mapping")
        return 1
    for k in set(doc) - TOP_LEVEL:
        err("root", f"unknown top-level key '{k}'")
    gen = (doc.get("previews") or {}).get("generation")
    if gen is not None and gen not in {"off", "manual", "automatic"}:
        err("previews", "generation must be off|manual|automatic")

    services = doc.get("services", []) or []
    databases = doc.get("databases", []) or []
    groups = doc.get("envVarGroups", []) or []
    names = {
        "services": {s.get("name"): s.get("type") for s in services},
        "databases": {d.get("name") for d in databases},
        "groups": {g.get("name") for g in groups},
    }
    all_names = [s.get("name") for s in services] + [d.get("name") for d in databases]
    for n in {n for n in all_names if all_names.count(n) > 1}:
        err("root", f"duplicate resource name '{n}'")

    for g in groups:
        check_env_vars(f"envVarGroups[{g.get('name')}]", g.get("envVars", []), in_group=True, names=names)
    for d in databases:
        check_database(d)
    for s in services:
        check_service(s, names)

    schema_note = try_official_schema(doc)
    print(f"{path}: {len(services)} service(s), {len(databases)} database(s), {len(groups)} env group(s); {schema_note}")
    if errors:
        print("\n".join(f"  ✗ {e}" for e in errors))
        return 1
    print("  ✓ render.yaml passes all checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
