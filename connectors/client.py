"""HTTP connectors. One class per source, same four operations."""

import httpx

from connectors.mappers import (
    map_ado_item,
    map_catalog,
    map_git_file,
    map_jira_issue,
    map_quickbase_record,
    map_sharepoint_item,
    records_from_workbook,
    delete_record,
)
from hub.config import mock_base_url
from hub.util import iso, parse_dt
from pipeline.logic import SourceUnavailable

SOURCE_ORDER = [
    "sharepoint",
    "ado",
    "jira",
    "rules",
    "quickbase",
    "git",
    "manual_tests",
    "transcripts",
    "jobaids",
    "andisense",
    "socs",
    "srts",
]


def _request(method: str, path: str, **kwargs):
    url = mock_base_url() + path
    try:
        response = httpx.request(method, url, timeout=5.0, **kwargs)
    except httpx.HTTPError as exc:
        raise SourceUnavailable(str(exc)) from exc
    if response.status_code in (429, 500, 502, 503, 504):
        raise SourceUnavailable(f"{response.status_code} from {path}")
    return response


def _newer(records: list[dict], watermark) -> list[dict]:
    if watermark is None:
        return records
    stamp = parse_dt(watermark)
    kept = []
    for record in records:
        modified = parse_dt(record.get("modified_at"))
        if modified is not None and modified > stamp:
            kept.append(record)
    return kept


class JiraConnector:
    name = "jira"

    def fetch_delta(self, watermark):
        params = {}
        if watermark is not None:
            params["updatedSince"] = iso(watermark)
        payload = _request("GET", "/rest/api/3/search", params=params).json()
        return _newer([map_jira_issue(issue) for issue in payload.get("issues") or []], watermark)

    def get_one(self, ref: str):
        response = _request("GET", f"/rest/api/3/issue/{ref}")
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_jira_issue(response.json())

    def list_ids(self) -> list[str]:
        return _request("GET", "/rest/api/3/ids").json()["ids"]


class AdoConnector:
    name = "ado"

    def fetch_delta(self, watermark):
        params = {}
        if watermark is not None:
            params["changedSince"] = iso(watermark)
        payload = _request("GET", "/ado/_apis/wit/workitems", params=params).json()
        return _newer([map_ado_item(item) for item in payload.get("value") or []], watermark)

    def get_one(self, ref: str):
        response = _request("GET", f"/ado/_apis/wit/workitems/{ref}")
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_ado_item(response.json())

    def list_ids(self) -> list[str]:
        return _request("GET", "/ado/_apis/wit/ids").json()["ids"]


class SharePointConnector:
    name = "sharepoint"

    def fetch_delta(self, watermark):
        params = {}
        if watermark is not None:
            params["since"] = iso(watermark)
        payload = _request("GET", "/graph/sites/brd/drive/delta", params=params).json()
        return _newer([map_sharepoint_item(item) for item in payload.get("value") or []], watermark)

    def get_one(self, ref: str):
        response = _request("GET", f"/graph/sites/brd/items/{ref}")
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_sharepoint_item(response.json())

    def list_ids(self) -> list[str]:
        return _request("GET", "/graph/sites/brd/ids").json()["ids"]


class QuickbaseConnector:
    name = "quickbase"

    def fetch_delta(self, watermark):
        body = {"since": iso(watermark)} if watermark is not None else {}
        payload = _request("POST", "/v1/records/query", json=body).json()
        return _newer([map_quickbase_record(item) for item in payload.get("data") or []], watermark)

    def get_one(self, ref: str):
        response = _request("GET", f"/v1/records/{ref}")
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_quickbase_record(response.json())

    def list_ids(self) -> list[str]:
        return _request("GET", "/v1/records/ids").json()["ids"]


class GitConnector:
    name = "git"

    def fetch_delta(self, watermark):
        params = {}
        if watermark is not None:
            params["since"] = iso(watermark)
        payload = _request("GET", "/repos/claims-service/files", params=params).json()
        return _newer([map_git_file(item) for item in payload.get("files") or []], watermark)

    def get_one(self, ref: str):
        response = _request("GET", "/repos/claims-service/file", params={"path": ref})
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_git_file(response.json())

    def list_ids(self) -> list[str]:
        return _request("GET", "/repos/claims-service/ids").json()["ids"]


class RulesConnector:
    name = "rules"

    def fetch_delta(self, watermark):
        response = _request("GET", "/rules/workbook.xlsx")
        response.raise_for_status()
        return _newer(records_from_workbook(response.content), watermark)

    def get_one(self, ref: str):
        for record in self.fetch_delta(None):
            if record["source_id"] == ref:
                return record
        return delete_record(self.name, ref)

    def list_ids(self) -> list[str]:
        return _request("GET", "/rules/ids").json()["ids"]


class CatalogConnector:
    def __init__(self, name: str, default_format: str):
        self.name = name
        self.default_format = default_format

    def fetch_delta(self, watermark):
        params = {}
        if watermark is not None:
            params["since"] = iso(watermark)
        payload = _request("GET", f"/catalog/{self.name}", params=params).json()
        mapped = [
            map_catalog(item, self.name, self.default_format) for item in payload.get("records") or []
        ]
        return _newer(mapped, watermark)

    def get_one(self, ref: str):
        response = _request("GET", f"/catalog/{self.name}/{ref}")
        if response.status_code == 404:
            return delete_record(self.name, ref)
        response.raise_for_status()
        return map_catalog(response.json(), self.name, self.default_format)

    def list_ids(self) -> list[str]:
        return _request("GET", f"/catalog/{self.name}/_ids").json()["ids"]


def build_registry() -> dict:
    connectors = [
        JiraConnector(),
        AdoConnector(),
        SharePointConnector(),
        QuickbaseConnector(),
        GitConnector(),
        RulesConnector(),
        CatalogConnector("manual_tests", "record"),
        CatalogConnector("transcripts", "transcript"),
        CatalogConnector("jobaids", "record"),
        CatalogConnector("andisense", "record"),
        CatalogConnector("socs", "record"),
        CatalogConnector("srts", "record"),
    ]
    return {connector.name: connector for connector in connectors}


_REGISTRY = None


def get_connector(name: str):
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = build_registry()
    if name not in _REGISTRY:
        raise KeyError(name)
    return _REGISTRY[name]


def materialize(source: str, event: str | None, ref: str | None) -> dict:
    if event and "delet" in event.lower() and ref:
        return delete_record(source, ref)
    if not ref:
        raise ValueError("webhook is missing a ref")
    return get_connector(source).get_one(ref)
