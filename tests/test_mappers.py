"""Vendor payloads round-trip into the canonical record."""

from connectors.mappers import (
    map_ado_item,
    map_catalog,
    map_git_file,
    map_jira_issue,
    map_quickbase_record,
    map_sharepoint_item,
    records_from_workbook,
)
from mock_sources.seed import seed_records
from mock_sources.shape import (
    shape_ado_item,
    shape_git_file,
    shape_jira_issue,
    shape_quickbase_fields,
    shape_sharepoint_item,
    workbook_bytes,
)


def _by_id(source):
    return {item["source_id"]: item for item in seed_records() if item["source"] == source}


def _same(left, right):
    assert left["source_id"] == right["source_id"]
    assert left["title"] == right["title"]
    assert left["body"] == right["body"]
    assert left["type"] == right["type"]
    assert left["logical_key"] == right["logical_key"]
    assert left["acl"] == right["acl"]
    assert left["deleted"] == right["deleted"]
    assert (left.get("attributes") or {}).get("threshold_usd") == (right.get("attributes") or {}).get("threshold_usd")
    assert (left.get("attributes") or {}).get("links") == (right.get("attributes") or {}).get("links")


def test_jira_ado_sharepoint_quickbase_git_round_trip():
    jira = _by_id("jira")["JIRA-501"]
    _same(map_jira_issue(shape_jira_issue(jira)), jira)

    ado = _by_id("ado")["EPIC-42"]
    _same(map_ado_item(shape_ado_item(ado)), ado)

    page = _by_id("sharepoint")["BR-101"]
    _same(map_sharepoint_item(shape_sharepoint_item(page)), page)

    quickbase = _by_id("quickbase")["QB-9"]
    _same(map_quickbase_record(shape_quickbase_fields(quickbase)), quickbase)

    code = _by_id("git")["src/approval/dual_approval.py"]
    mapped = map_git_file(shape_git_file(code))
    _same(mapped, code)
    assert mapped["attributes"]["path"] == code["source_id"]
    assert mapped["format"] == "code"


def test_workbook_rows_keep_the_cell():
    rules = [item for item in seed_records() if item["source"] == "rules"]
    parsed = {item["source_id"]: item for item in records_from_workbook(workbook_bytes(rules))}
    assert parsed["RULE-17"]["attributes"]["threshold_usd"] == 10000
    assert parsed["RULE-17"]["attributes"]["cell"] == "D2"
    assert parsed["RULE-17"]["attributes"]["links"][0]["target"] == "BR-101"
    assert parsed["RULE-18"]["attributes"]["threshold_usd"] is None
    assert parsed["RULE-18"]["attributes"]["cell"] == "C3"


def test_catalog_transcript_keeps_format():
    meeting = _by_id("transcripts")["MTG-2026-03-12"]
    mapped = map_catalog(meeting, "transcripts", "record")
    assert mapped["format"] == "transcript"
    assert "BR-101" in mapped["body"]
    assert mapped["attributes"]["links"][0]["target"] == "BR-101"
