"""Shape canonical records into the external API each connector expects."""

import io
import json

import openpyxl

from connectors.mappers import QUICKBASE_FIELDS


def _links_jira(record):
    shaped = []
    for link in (record.get("attributes") or {}).get("links") or []:
        shaped.append(
            {
                "type": {"name": link.get("type") or "RELATES"},
                "outwardIssue": {"key": link["target"]},
            }
        )
    return shaped


def shape_jira_issue(record: dict) -> dict:
    attributes = record.get("attributes") or {}
    return {
        "key": record["source_id"],
        "self": record.get("uri"),
        "deleted": bool(record.get("deleted")),
        "version": record.get("source_version"),
        "fields": {
            "summary": record.get("title"),
            "description": record.get("body"),
            "updated": record.get("modified_at"),
            "issuetype": {"name": record.get("type") or "story"},
            "issuelinks": _links_jira(record),
            "customfield_10050": attributes.get("threshold_usd"),
            "customfield_10051": record.get("logical_key"),
            "security": {"principals": list(record.get("acl") or [])},
        },
    }


def shape_ado_item(record: dict) -> dict:
    attributes = record.get("attributes") or {}
    relations = []
    for link in attributes.get("links") or []:
        relations.append(
            {
                "rel": "System.LinkTypes.Related",
                "attributes": {"name": link.get("type") or "RELATED", "comment": link["target"]},
            }
        )
    return {
        "id": record["source_id"],
        "rev": record.get("source_version"),
        "url": record.get("uri"),
        "deleted": bool(record.get("deleted")),
        "fields": {
            "System.WorkItemType": record.get("type"),
            "System.Title": record.get("title"),
            "System.Description": record.get("body"),
            "System.ChangedDate": record.get("modified_at"),
            "Custom.LogicalKey": record.get("logical_key"),
            "Custom.Threshold": attributes.get("threshold_usd"),
            "Custom.Principals": ";".join(record.get("acl") or []),
        },
        "relations": relations,
    }


def shape_sharepoint_item(record: dict) -> dict:
    attributes = record.get("attributes") or {}
    return {
        "id": record["source_id"],
        "name": f"{record['source_id']}.md",
        "eTag": str(record.get("source_version") or ""),
        "lastModifiedDateTime": record.get("modified_at"),
        "webUrl": record.get("uri"),
        "content": record.get("body") or "",
        "deleted": bool(record.get("deleted")),
        "listItem": {
            "fields": {
                "Title": record.get("title"),
                "LogicalKey": record.get("logical_key"),
                "Threshold": attributes.get("threshold_usd"),
                "Principals": list(record.get("acl") or []),
                "Links": attributes.get("links") or [],
                "DocType": record.get("type"),
            }
        },
    }


def _qb_cell(value):
    return {"value": value}


def shape_quickbase_fields(record: dict) -> dict:
    attributes = record.get("attributes") or {}
    links = json.dumps(attributes.get("links") or [])
    return {
        QUICKBASE_FIELDS["id"]: _qb_cell(record["source_id"]),
        QUICKBASE_FIELDS["title"]: _qb_cell(record.get("title")),
        QUICKBASE_FIELDS["modified"]: _qb_cell(record.get("modified_at")),
        QUICKBASE_FIELDS["body"]: _qb_cell(record.get("body")),
        QUICKBASE_FIELDS["threshold"]: _qb_cell(attributes.get("threshold_usd")),
        QUICKBASE_FIELDS["logical_key"]: _qb_cell(record.get("logical_key")),
        QUICKBASE_FIELDS["acl"]: _qb_cell(",".join(record.get("acl") or [])),
        QUICKBASE_FIELDS["links"]: _qb_cell(links),
        QUICKBASE_FIELDS["version"]: _qb_cell(record.get("source_version")),
        QUICKBASE_FIELDS["deleted"]: _qb_cell(bool(record.get("deleted"))),
        QUICKBASE_FIELDS["uri"]: _qb_cell(record.get("uri")),
        QUICKBASE_FIELDS["type"]: _qb_cell(record.get("type")),
    }


def shape_git_file(record: dict) -> dict:
    attributes = record.get("attributes") or {}
    return {
        "path": record["source_id"],
        "sha": record.get("source_version"),
        "modified_at": record.get("modified_at"),
        "content": record.get("body") or "",
        "deleted": bool(record.get("deleted")),
        "html_url": record.get("uri"),
        "acl": list(record.get("acl") or []),
        "links": attributes.get("links") or [],
        "logical_key": record.get("logical_key"),
        "threshold_usd": attributes.get("threshold_usd"),
        "title": record.get("title"),
    }


def workbook_bytes(records: list[dict]) -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Rules"
    sheet.append(
        [
            "rule_id",
            "title",
            "statement",
            "threshold_usd",
            "logical_key",
            "updated_at",
            "version",
            "acl",
            "links_json",
            "deleted",
            "uri",
            "type",
        ]
    )
    for record in records:
        attributes = record.get("attributes") or {}
        sheet.append(
            [
                record["source_id"],
                record.get("title"),
                record.get("body"),
                attributes.get("threshold_usd"),
                record.get("logical_key"),
                record.get("modified_at"),
                record.get("source_version"),
                "|".join(record.get("acl") or []),
                json.dumps(attributes.get("links") or []),
                bool(record.get("deleted")),
                record.get("uri"),
                record.get("type"),
            ]
        )
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
