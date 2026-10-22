"""Chunking, hashing, and safety checks. No database."""

from mock_sources.seed import DUAL_APPROVAL_PY, TRANSCRIPT, seed_records
from pipeline.logic import (
    chunks_for,
    detect_injection,
    detect_pii,
    embed,
    jaccard,
    policy_type,
)


def test_injection_and_pii_match_the_seed_corpus():
    records = {item["source_id"]: item for item in seed_records()}
    assert detect_injection(records["JA-99"]["body"])
    assert not detect_injection(records["BR-101"]["body"])
    assert "ssn" in detect_pii(records["BR-103"]["body"])
    assert "email" in detect_pii(records["BR-103"]["body"])
    assert detect_pii(records["BR-101"]["body"]) == []


def test_python_and_transcript_chunks_keep_locators():
    code = chunks_for(
        {
            "format": "code",
            "title": "guard",
            "body": DUAL_APPROVAL_PY,
            "source_id": "src/approval/dual_approval.py",
            "attributes": {"path": "src/approval/dual_approval.py"},
        }
    )
    names = [chunk["locator"]["symbol"] for chunk in code]
    assert names == ["requires_dual_approval", "load_threshold"]
    assert code[0]["locator"]["line_start"] >= 1

    cues = chunks_for({"format": "transcript", "title": "workshop", "body": TRANSCRIPT, "attributes": {}})
    assert len(cues) == 3
    assert cues[0]["locator"]["start"] == "00:01:12.000"
    assert "JIRA-502" in cues[0]["text"]


def test_embedding_is_stable_and_policy_follows_the_key():
    assert len(embed("BR-101 dual approval")) == 64
    assert embed("BR-101") == embed("BR-101")
    assert policy_type("RULE-17") == "config_rule"
    assert policy_type("BR-101") == "business_requirement"
    assert jaccard("one two three", "one two four") > 0.4
