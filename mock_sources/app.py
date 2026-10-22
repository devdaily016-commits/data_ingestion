"""Fake Jira, Azure DevOps, SharePoint, Quickbase, Git, and file drops.

Control routes stay up during an outage. Data routes return 503 so connectors
can open the circuit breaker. Mutations optionally notify the hub webhook.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from hub.util import parse_dt
from mock_sources.seed import seed_records
from mock_sources.shape import (
    shape_ado_item,
    shape_git_file,
    shape_jira_issue,
    shape_quickbase_fields,
    shape_sharepoint_item,
    workbook_bytes,
)

ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = Path(os.environ.get("MOCK_STATE", ROOT / "data" / "mock_state.json"))
HUB = os.environ.get("HUB_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

app = FastAPI(title="ClaimPath source sandbox")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = threading.Lock()
STATE = {"records": [], "outages": {}}


def _load() -> None:
    if STATE_PATH.exists():
        saved = json.loads(STATE_PATH.read_text())
        STATE["records"] = saved.get("records") or []
        STATE["outages"] = saved.get("outages") or {}
        return
    STATE["records"] = seed_records()
    STATE["outages"] = {}
    _save()


def _save() -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(STATE, indent=2))


def _bump(value) -> str:
    text = str(value or "1")
    if text.isdigit():
        return str(int(text) + 1)
    return f"{text}-2"


def _find(source: str, source_id: str) -> dict:
    for record in STATE["records"]:
        if record["source"] == source and record["source_id"] == source_id:
            return record
    raise HTTPException(status_code=404, detail=f"{source}:{source_id} not found")


def _guard(source: str) -> None:
    if STATE["outages"].get(source):
        raise HTTPException(status_code=503, detail=f"{source} is offline")


def _changed(source: str, since: str | None) -> list[dict]:
    rows = [record for record in STATE["records"] if record["source"] == source]
    if not since:
        return rows
    stamp = parse_dt(since)
    return [record for record in rows if parse_dt(record.get("modified_at")) > stamp]


def _notify(source: str, event: str, ref: str) -> None:
    try:
        httpx.post(
            f"{HUB}/api/webhooks/{source}",
            json={"event": event, "ref": ref},
            timeout=2.0,
        )
    except httpx.HTTPError:
        return


def _notify_record(record: dict) -> None:
    try:
        httpx.post(
            f"{HUB}/api/webhooks/{record['source']}",
            json={"event": "record", "record": record},
            timeout=2.0,
        )
    except httpx.HTTPError:
        return


@app.on_event("startup")
def startup() -> None:
    with _lock:
        _load()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/control/health")
def control_health():
    counts = {}
    for record in STATE["records"]:
        if record.get("deleted"):
            continue
        counts[record["source"]] = counts.get(record["source"], 0) + 1
    return {"ok": True, "outages": STATE["outages"], "counts": counts}


@app.post("/control/reset")
def reset():
    with _lock:
        if STATE_PATH.exists():
            STATE_PATH.unlink()
        STATE["records"] = seed_records()
        STATE["outages"] = {}
        _save()
    return {"ok": True}


@app.post("/control/outage")
def outage(body: dict):
    source = body["source"]
    with _lock:
        STATE["outages"][source] = bool(body.get("down"))
        _save()
    return {"ok": True, "outages": STATE["outages"]}


@app.post("/control/mutate")
def mutate(body: dict):
    with _lock:
        record = _find(body["source"], body["source_id"])
        patch = body.get("patch") or {}
        attributes = record.setdefault("attributes", {})
        for field in ("title", "body", "logical_key", "format"):
            if field in patch:
                record[field] = patch[field]
        if "acl" in patch:
            record["acl"] = list(patch["acl"])
        if "deleted" in patch:
            record["deleted"] = bool(patch["deleted"])
        if "threshold_usd" in patch:
            attributes["threshold_usd"] = patch["threshold_usd"]
        if "links" in patch:
            attributes["links"] = patch["links"]
        if "force_fail" in patch:
            attributes["force_fail"] = bool(patch["force_fail"])
        record["source_version"] = _bump(record.get("source_version"))
        record["modified_at"] = datetime.now(timezone.utc).isoformat()
        _save()
        snapshot = json.loads(json.dumps(record))
    if not body.get("silent"):
        if body.get("embed"):
            _notify_record(snapshot)
        else:
            _notify(snapshot["source"], body.get("event") or f"{snapshot['source']}:updated", snapshot["source_id"])
    return {"ok": True, "source_id": snapshot["source_id"], "modified_at": snapshot["modified_at"]}


@app.post("/control/add")
def add(body: dict):
    record = body["record"]
    record.setdefault("attributes", {})
    record["attributes"].setdefault("format", record.get("format") or "record")
    with _lock:
        STATE["records"] = [
            item
            for item in STATE["records"]
            if not (item["source"] == record["source"] and item["source_id"] == record["source_id"])
        ]
        STATE["records"].append(record)
        _save()
    if not body.get("silent"):
        _notify_record(record)
    return {"ok": True, "source_id": record["source_id"]}


@app.get("/rest/api/3/search")
def jira_search(updatedSince: str | None = None):
    _guard("jira")
    issues = [shape_jira_issue(item) for item in _changed("jira", updatedSince)]
    return {"startAt": 0, "total": len(issues), "issues": issues}


@app.get("/rest/api/3/ids")
def jira_ids():
    _guard("jira")
    return {"ids": [item["source_id"] for item in _changed("jira", None) if not item.get("deleted")]}


@app.get("/rest/api/3/issue/{key}")
def jira_issue(key: str):
    _guard("jira")
    return shape_jira_issue(_find("jira", key))


@app.get("/ado/_apis/wit/workitems")
def ado_list(changedSince: str | None = None):
    _guard("ado")
    return {"value": [shape_ado_item(item) for item in _changed("ado", changedSince)]}


@app.get("/ado/_apis/wit/ids")
def ado_ids():
    _guard("ado")
    return {"ids": [item["source_id"] for item in _changed("ado", None) if not item.get("deleted")]}


@app.get("/ado/_apis/wit/workitems/{item_id}")
def ado_item(item_id: str):
    _guard("ado")
    return shape_ado_item(_find("ado", item_id))


@app.get("/graph/sites/brd/drive/delta")
def sharepoint_delta(since: str | None = None):
    _guard("sharepoint")
    return {"value": [shape_sharepoint_item(item) for item in _changed("sharepoint", since)]}


@app.get("/graph/sites/brd/ids")
def sharepoint_ids():
    _guard("sharepoint")
    return {"ids": [item["source_id"] for item in _changed("sharepoint", None) if not item.get("deleted")]}


@app.get("/graph/sites/brd/items/{item_id}")
def sharepoint_item(item_id: str):
    _guard("sharepoint")
    return shape_sharepoint_item(_find("sharepoint", item_id))


@app.post("/v1/records/query")
def quickbase_query(body: dict | None = None):
    _guard("quickbase")
    since = (body or {}).get("since")
    return {
        "data": [shape_quickbase_fields(item) for item in _changed("quickbase", since)],
        "metadata": {"field_map": "see connectors/mappers.py QUICKBASE_FIELDS"},
    }


@app.get("/v1/records/ids")
def quickbase_ids():
    _guard("quickbase")
    return {"ids": [item["source_id"] for item in _changed("quickbase", None) if not item.get("deleted")]}


@app.get("/v1/records/{record_id}")
def quickbase_record(record_id: str):
    _guard("quickbase")
    return shape_quickbase_fields(_find("quickbase", record_id))


@app.get("/repos/claims-service/files")
def git_files(since: str | None = None):
    _guard("git")
    return {"files": [shape_git_file(item) for item in _changed("git", since)]}


@app.get("/repos/claims-service/ids")
def git_ids():
    _guard("git")
    return {"ids": [item["source_id"] for item in _changed("git", None) if not item.get("deleted")]}


@app.get("/repos/claims-service/file")
def git_file(path: str):
    _guard("git")
    return shape_git_file(_find("git", path))


@app.get("/rules/workbook.xlsx")
def rules_workbook():
    _guard("rules")
    data = workbook_bytes([item for item in STATE["records"] if item["source"] == "rules"])
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/rules/ids")
def rules_ids():
    _guard("rules")
    return {"ids": [item["source_id"] for item in _changed("rules", None) if not item.get("deleted")]}


@app.get("/catalog/{source}/_ids")
def catalog_ids(source: str):
    _guard(source)
    return {"ids": [item["source_id"] for item in _changed(source, None) if not item.get("deleted")]}


@app.get("/catalog/{source}")
def catalog(source: str, since: str | None = None):
    _guard(source)
    records = []
    for item in _changed(source, since):
        exposed = dict(item)
        exposed.pop("raw", None)
        records.append(exposed)
    return {"records": records}


@app.get("/catalog/{source}/{ref}")
def catalog_one(source: str, ref: str):
    _guard(source)
    record = dict(_find(source, ref))
    record.pop("raw", None)
    return record
