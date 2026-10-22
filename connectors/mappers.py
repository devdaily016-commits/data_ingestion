"""Map source payloads into the canonical ingest record.

Each mapper is the only place that knows a vendor's field names. The rest of
the pipeline never sees a Jira issue or a Quickbase field id.
"""

import io
import json

import openpyxl

from hub.util import iso


QUICKBASE_FIELDS = {
    "id": "3",
    "title": "6",
    "modified": "7",
    "body": "8",
    "threshold": "9",
    "logical_key": "10",
    "acl": "11",
    "links": "12",
    "version": "13",
    "deleted": "14",
    "uri": "15",
    "type": "16",
}


def delete_record(source: str, source_id: str) -> dict:
    return {
        "source": source,
        "source_id": source_id,
        "type": "record",
        "title": "",
        "body": "",
        "format": "record",
        "modified_at": None,
        "source_version": "deleted",
        "deleted": True,
        "acl": [],
        "uri": "",
        "logical_key": None,
        "attributes": {},
        "raw": {"deleted": True, "source_id": source_id},
    }


def _base(source, source_id, entity_type, title, body, fmt, modified, version, deleted, acl, uri, logical_key, attributes, raw):
    attributes = dict(attributes or {})
    attributes["format"] = fmt
    return {
        "source": source,
        "source_id": source_id,
        "type": entity_type,
        "title": title or "",
        "body": body or "",
        "format": fmt,
        "modified_at": iso(modified) if modified else None,
        "source_version": "" if version is None else str(version),
        "deleted": bool(deleted),
        "acl": list(acl or []),
        "uri": uri or "",
        "logical_key": logical_key,
        "attributes": attributes,
        "raw": raw,
    }


def map_jira_issue(issue: dict) -> dict:
    fields = issue.get("fields") or {}
    links = []
    for link in fields.get("issuelinks") or []:
        target = (link.get("outwardIssue") or {}).get("key")
        if not target:
            continue
        links.append(
            {
                "target": target,
                "type": (link.get("type") or {}).get("name") or "RELATES",
            }
        )
    security = fields.get("security") or {}
    return _base(
        "jira",
        issue["key"],
        (fields.get("issuetype") or {}).get("name") or "story",
        fields.get("summary"),
        fields.get("description"),
        "record",
        fields.get("updated"),
        issue.get("version"),
        issue.get("deleted"),
        security.get("principals"),
        issue.get("self"),
        fields.get("customfield_10051"),
        {"threshold_usd": fields.get("customfield_10050"), "links": links},
        issue,
    )


def map_ado_item(item: dict) -> dict:
    fields = item.get("fields") or {}
    links = []
    for relation in item.get("relations") or []:
        comment = (relation.get("attributes") or {}).get("comment")
        if not comment:
            continue
        links.append(
            {
                "target": comment,
                "type": (relation.get("attributes") or {}).get("name") or "RELATED",
            }
        )
    principals = fields.get("Custom.Principals") or ""
    acl = [part for part in principals.split(";") if part]
    return _base(
        "ado",
        str(item["id"]),
        fields.get("System.WorkItemType") or "work_item",
        fields.get("System.Title"),
        fields.get("System.Description"),
        "record",
        fields.get("System.ChangedDate"),
        item.get("rev"),
        item.get("deleted"),
        acl,
        item.get("url"),
        fields.get("Custom.LogicalKey"),
        {"threshold_usd": fields.get("Custom.Threshold"), "links": links},
        item,
    )


def map_sharepoint_item(item: dict) -> dict:
    fields = ((item.get("listItem") or {}).get("fields") or {})
    return _base(
        "sharepoint",
        item["id"],
        fields.get("DocType") or "business_requirement",
        fields.get("Title"),
        item.get("content"),
        "markdown",
        item.get("lastModifiedDateTime"),
        item.get("eTag"),
        item.get("deleted"),
        fields.get("Principals"),
        item.get("webUrl"),
        fields.get("LogicalKey"),
        {"threshold_usd": fields.get("Threshold"), "links": fields.get("Links") or []},
        item,
    )


def map_quickbase_record(fields: dict) -> dict:
    def value(key):
        cell = fields.get(QUICKBASE_FIELDS[key]) or {}
        return cell.get("value")

    links_raw = value("links") or "[]"
    if isinstance(links_raw, str):
        links = json.loads(links_raw) if links_raw else []
    else:
        links = links_raw
    acl_raw = value("acl") or ""
    acl = [part for part in str(acl_raw).split(",") if part]
    return _base(
        "quickbase",
        str(value("id")),
        value("type") or "config_rule",
        value("title"),
        value("body"),
        "record",
        value("modified"),
        value("version"),
        value("deleted"),
        acl,
        value("uri"),
        value("logical_key"),
        {"threshold_usd": value("threshold"), "links": links},
        fields,
    )


def map_git_file(item: dict) -> dict:
    return _base(
        "git",
        item["path"],
        "code",
        item.get("title") or item["path"],
        item.get("content"),
        "code",
        item.get("modified_at"),
        item.get("sha"),
        item.get("deleted"),
        item.get("acl"),
        item.get("html_url"),
        item.get("logical_key"),
        {
            "threshold_usd": item.get("threshold_usd"),
            "links": item.get("links") or [],
            "path": item["path"],
            "language": "python",
        },
        item,
    )


def map_catalog(item: dict, source: str, default_format: str) -> dict:
    attributes = dict(item.get("attributes") or {})
    fmt = item.get("format") or default_format
    attributes.setdefault("links", item.get("links") or attributes.get("links") or [])
    if "threshold_usd" not in attributes and item.get("threshold_usd") is not None:
        attributes["threshold_usd"] = item.get("threshold_usd")
    return _base(
        source,
        item["source_id"],
        item.get("type") or "record",
        item.get("title"),
        item.get("body"),
        fmt,
        item.get("modified_at"),
        item.get("source_version"),
        item.get("deleted"),
        item.get("acl"),
        item.get("uri"),
        item.get("logical_key"),
        attributes,
        item,
    )


def records_from_workbook(data: bytes) -> list[dict]:
    workbook = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    sheet = workbook["Rules"]
    records = []
    for index, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        padded = list(row) + [None] * 12
        (
            rule_id,
            title,
            statement,
            threshold,
            logical_key,
            updated,
            version,
            acl_raw,
            links_raw,
            deleted,
            uri,
            entity_type,
        ) = padded[:12]
        if not rule_id:
            continue
        links = json.loads(links_raw) if isinstance(links_raw, str) and links_raw else (links_raw or [])
        acl = [part for part in str(acl_raw or "").split("|") if part]
        threshold_value = None if threshold in (None, "") else threshold
        if isinstance(threshold_value, float) and threshold_value.is_integer():
            threshold_value = int(threshold_value)
        cell = f"D{index}" if threshold_value is not None else f"C{index}"
        records.append(
            _base(
                "rules",
                str(rule_id),
                entity_type or "config_rule",
                title,
                statement,
                "spreadsheet_row",
                iso(updated) if updated else None,
                version,
                deleted in (True, "true", "TRUE", 1),
                acl,
                uri,
                logical_key,
                {
                    "threshold_usd": threshold_value,
                    "links": links,
                    "sheet": "Rules",
                    "row": index,
                    "cell": cell,
                },
                {"sheet": "Rules", "row": index},
            )
        )
    return records
