"""Canonical upsert: idempotency, tombstones, quarantine, links, conflicts."""

from psycopg.types.json import Json

from hub.config import PARSER_VERSION
from hub.db import pool
from hub.util import json_safe, parse_dt
from pipeline import blob
from pipeline.logic import (
    ID_RE,
    LINK_METHODS,
    PoisonRecord,
    body_hash,
    chunks_for,
    content_hash,
    detect_injection,
    detect_pii,
    embed,
    jaccard,
    policy_type,
    vector_literal,
)


def entity_id_for(source: str, source_id: str) -> str:
    return f"{source}:{source_id}"


def ingest_record(record: dict, run_id: int | None = None) -> str:
    with pool().connection() as conn:
        try:
            outcome = _ingest(conn, record, run_id)
        except PoisonRecord:
            # Keep the failure lineage. The queue layer decides whether to retry.
            conn.commit()
            raise
        conn.commit()
        return outcome


def _lineage(conn, stage, message, source, entity_id, run_id, detail=None):
    conn.execute(
        """
        INSERT INTO lineage_event (run_id, entity_id, source, stage, message, detail)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (run_id, entity_id, source, stage, message, Json(detail or {})),
    )


def _bump(conn, run_id, column):
    if not run_id:
        return
    allowed = {"received", "upserted", "noop", "deleted", "failed", "quarantined"}
    if column not in allowed:
        raise ValueError(column)
    conn.execute(
        f"UPDATE ingest_run SET {column} = {column} + 1 WHERE id = %s",
        (run_id,),
    )


def _unchanged(conn, record: dict, eid: str) -> bool:
    if record.get("deleted"):
        return False
    row = conn.execute(
        "SELECT content_hash, deleted, status, acl_principals FROM entity WHERE id = %s",
        (eid,),
    ).fetchone()
    if row is None or row["deleted"]:
        return False
    if row["status"] not in ("active", "quarantined"):
        return False
    attributes = record.get("attributes") or {}
    digest = content_hash(record.get("title"), record.get("body"), attributes.get("threshold_usd"))
    if row["content_hash"] != digest:
        return False
    if sorted(row["acl_principals"] or []) != sorted(record.get("acl") or []):
        return False
    return True


def _rank(conn, entity_type: str, source: str) -> int:
    row = conn.execute(
        """
        SELECT rank FROM authority_rule
        WHERE entity_type = %s AND source = %s
        """,
        (entity_type, source),
    ).fetchone()
    return row["rank"] if row else 50


def _ingest(conn, record: dict, run_id: int | None) -> str:
    source = record["source"]
    source_id = record["source_id"]
    eid = entity_id_for(source, source_id)
    attributes = dict(record.get("attributes") or {})
    _lineage(
        conn,
        "received",
        f"Accepted {source}:{source_id}",
        source,
        eid,
        run_id,
    )
    _bump(conn, run_id, "received")

    if attributes.get("force_fail"):
        _lineage(
            conn,
            "failed",
            f"Parser refused {source_id}",
            source,
            eid,
            run_id,
            {"error": "forced parser failure"},
        )
        _bump(conn, run_id, "failed")
        raise PoisonRecord(source_id)

    if _unchanged(conn, record, eid):
        _lineage(conn, "noop", f"No content change for {source_id}", source, eid, run_id)
        _bump(conn, run_id, "noop")
        return "noop"

    raw_path = blob.put(
        source,
        source_id,
        str(record.get("source_version") or "0"),
        {"record": record, "raw": record.get("raw")},
    )
    _lineage(
        conn,
        "raw",
        f"Landed immutable payload at {raw_path}",
        source,
        eid,
        run_id,
        {"raw_blob_path": raw_path},
    )

    if record.get("deleted"):
        return _tombstone(conn, record, eid, raw_path, run_id)

    chunks = chunks_for(record)
    _lineage(
        conn,
        "parsed",
        f"Parsed {len(chunks)} chunk{'s' if len(chunks) != 1 else ''} ({record.get('format') or 'record'})",
        source,
        eid,
        run_id,
        {"chunks": len(chunks), "format": record.get("format")},
    )

    threshold = attributes.get("threshold_usd")
    title = record.get("title") or ""
    body = record.get("body") or ""
    flags = []
    pii = detect_pii(f"{title}\n{body}")
    if pii:
        flags.append("pii")
    injected = detect_injection(f"{title}\n{body}")
    if injected:
        flags.append("injection")

    _lineage(
        conn,
        "normalized",
        f"Canonical {record.get('type') or 'record'} {source_id}",
        source,
        eid,
        run_id,
        {"logical_key": record.get("logical_key"), "flags": flags},
    )

    if injected:
        outcome = _write_entity(
            conn,
            record,
            eid,
            raw_path,
            chunks,
            flags,
            status="quarantined",
            active_chunks=False,
            run_id=run_id,
            change_type="quarantine",
        )
        if outcome == "noop":
            _lineage(conn, "noop", f"Quarantine for {source_id} already recorded", source, eid, run_id)
            _bump(conn, run_id, "noop")
            return "noop"
        _lineage(
            conn,
            "quarantined",
            "Hidden instruction detected. Raw copy kept. Not indexed for agents.",
            source,
            eid,
            run_id,
            {"flags": flags},
        )
        _bump(conn, run_id, "quarantined")
        relink_all(conn)
        return "quarantined"

    outcome = _write_entity(
        conn,
        record,
        eid,
        raw_path,
        chunks,
        flags,
        status="active",
        active_chunks=True,
        run_id=run_id,
        change_type="upsert",
    )
    if outcome == "noop":
        _lineage(conn, "noop", f"No content change for {source_id}", source, eid, run_id)
        _bump(conn, run_id, "noop")
        return "noop"
    if outcome == "acl":
        _lineage(
            conn,
            "acl",
            f"Permissions changed for {source_id}. Content version unchanged.",
            source,
            eid,
            run_id,
        )
        _bump(conn, run_id, "noop")
        relink_all(conn)
        return "acl"

    _lineage(
        conn,
        "enriched",
        _enrich_message(flags, chunks),
        source,
        eid,
        run_id,
        {"flags": flags},
    )
    relink_all(conn)
    _lineage(
        conn,
        "indexed",
        f"Indexed {source_id} for retrieval",
        source,
        eid,
        run_id,
    )
    _bump(conn, run_id, "upserted")
    return "upserted"


def _enrich_message(flags, chunks) -> str:
    notes = []
    if "pii" in flags:
        notes.append("PII flagged")
    notes.append(f"{len(chunks)} chunk{'s' if len(chunks) != 1 else ''} embedded")
    return "; ".join(notes)


def _tombstone(conn, record, eid, raw_path, run_id) -> str:
    source = record["source"]
    row = conn.execute("SELECT * FROM entity WHERE id = %s FOR UPDATE", (eid,)).fetchone()
    if row is None or row["deleted"]:
        _lineage(
            conn,
            "noop",
            f"Delete for {record['source_id']} had nothing active to retire",
            source,
            eid,
            run_id,
        )
        _bump(conn, run_id, "noop")
        return "noop"
    now_version = row["version"] + 1
    conn.execute(
        """
        INSERT INTO entity_version
          (entity_id, version, content_hash, title, body, modified_at, ingested_at, raw_blob_path, change_type)
        VALUES (%s, %s, %s, %s, %s, now(), now(), %s, 'delete')
        """,
        (eid, now_version, row["content_hash"], row["title"], row["body"], raw_path),
    )
    conn.execute(
        """
        UPDATE entity
        SET deleted = TRUE,
            status = 'tombstoned',
            valid_to = now(),
            version = %s,
            ingested_at = now(),
            raw_blob_path = %s,
            modified_at = COALESCE(%s, modified_at)
        WHERE id = %s
        """,
        (now_version, raw_path, parse_dt(record.get("modified_at")), eid),
    )
    conn.execute("UPDATE chunk SET active = FALSE WHERE entity_id = %s", (eid,))
    conn.execute(
        "UPDATE edge SET active = FALSE WHERE from_id = %s OR to_id = %s",
        (eid, eid),
    )
    _lineage(
        conn,
        "tombstoned",
        f"Retired {record['source_id']}. History kept, index entry removed.",
        source,
        eid,
        run_id,
    )
    _bump(conn, run_id, "deleted")
    relink_all(conn)
    return "deleted"


def _write_entity(conn, record, eid, raw_path, chunks, flags, status, active_chunks, run_id, change_type):
    attributes = dict(record.get("attributes") or {})
    threshold = attributes.get("threshold_usd")
    title = record.get("title") or ""
    body = record.get("body") or ""
    digest = content_hash(title, body, threshold)
    bhash = body_hash(body)
    acl = list(record.get("acl") or [])
    rank = _rank(conn, record.get("type") or "record", record["source"])
    modified = parse_dt(record.get("modified_at"))
    row = conn.execute("SELECT * FROM entity WHERE id = %s FOR UPDATE", (eid,)).fetchone()

    if (
        row
        and row["content_hash"] == digest
        and not row["deleted"]
        and row["status"] == status
    ):
        if sorted(row["acl_principals"] or []) != sorted(acl):
            conn.execute(
                """
                UPDATE entity
                SET acl_principals = %s,
                    ingested_at = now(),
                    modified_at = COALESCE(%s, modified_at),
                    source_version = %s,
                    raw_blob_path = %s
                WHERE id = %s
                """,
                (acl, modified, str(record.get("source_version") or ""), raw_path, eid),
            )
            return "acl"
        return "noop"

    version = 1 if row is None else row["version"] + 1
    if row is None:
        conn.execute(
            """
            INSERT INTO entity (
              id, type, source, source_id, title, body, version, content_hash, body_hash,
              source_version, source_uri, modified_at, ingested_at, valid_from,
              deleted, authority_rank, acl_principals, parser_version, raw_blob_path,
              status, flags, logical_key, attributes
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, now(), COALESCE(%s, now()),
              FALSE, %s, %s, %s, %s,
              %s, %s, %s, %s
            )
            """,
            (
                eid,
                record.get("type") or "record",
                record["source"],
                record["source_id"],
                title,
                body,
                version,
                digest,
                bhash,
                str(record.get("source_version") or ""),
                record.get("uri") or "",
                modified,
                modified,
                rank,
                acl,
                PARSER_VERSION,
                raw_path,
                status,
                flags,
                record.get("logical_key"),
                Json(json_safe(attributes)),
            ),
        )
    else:
        conn.execute(
            """
            UPDATE entity SET
              type = %s, title = %s, body = %s, version = %s, content_hash = %s, body_hash = %s,
              source_version = %s, source_uri = %s, modified_at = %s, ingested_at = now(),
              valid_from = COALESCE(valid_from, %s), valid_to = NULL, deleted = FALSE,
              authority_rank = %s, acl_principals = %s, parser_version = %s, raw_blob_path = %s,
              status = %s, flags = %s, logical_key = %s, attributes = %s
            WHERE id = %s
            """,
            (
                record.get("type") or "record",
                title,
                body,
                version,
                digest,
                bhash,
                str(record.get("source_version") or ""),
                record.get("uri") or "",
                modified,
                modified,
                rank,
                acl,
                PARSER_VERSION,
                raw_path,
                status,
                flags,
                record.get("logical_key"),
                Json(json_safe(attributes)),
                eid,
            ),
        )

    conn.execute(
        """
        INSERT INTO entity_version
          (entity_id, version, content_hash, title, body, modified_at, ingested_at, raw_blob_path, change_type)
        VALUES (%s, %s, %s, %s, %s, %s, now(), %s, %s)
        """,
        (eid, version, digest, title, body, modified, raw_path, change_type),
    )
    _replace_chunks(conn, eid, chunks, active_chunks)
    return "upserted"


def _replace_chunks(conn, eid, chunks, active):
    conn.execute("DELETE FROM chunk WHERE entity_id = %s", (eid,))
    for chunk in chunks:
        text = chunk["text"]
        conn.execute(
            """
            INSERT INTO chunk (id, entity_id, ordinal, text, embedding, locator, active)
            VALUES (%s, %s, %s, %s, %s::vector, %s, %s)
            """,
            (
                f"{eid}#{chunk['ordinal']}",
                eid,
                chunk["ordinal"],
                text,
                vector_literal(embed(text)),
                Json(chunk.get("locator") or {}),
                active,
            ),
        )


def relink_all(conn) -> None:
    entities = conn.execute(
        """
        SELECT id, source, source_id, type, title, body, body_hash, authority_rank,
               logical_key, attributes, format_hint
        FROM (
          SELECT id, source, source_id, type, title, body, body_hash, authority_rank,
                 logical_key, attributes, attributes->>'format' AS format_hint
          FROM entity
          WHERE deleted = FALSE AND status = 'active'
        ) AS active_entities
        """
    ).fetchall()
    # format lives on the record, not always in attributes. Mentions use body.
    if not entities:
        conn.execute("DELETE FROM conflict WHERE resolved = FALSE")
        return
    ids = [row["id"] for row in entities]
    conn.execute(
        """
        DELETE FROM edge
        WHERE from_id = ANY(%s)
          AND method = ANY(%s)
        """,
        (ids, list(LINK_METHODS)),
    )
    by_source_id: dict[str, list[str]] = {}
    for row in entities:
        by_source_id.setdefault(row["source_id"], []).append(row["id"])

    for row in entities:
        attributes = row["attributes"] or {}
        explicit_targets = set()
        for link in attributes.get("links") or []:
            target = link.get("target")
            if not target:
                continue
            for target_id in by_source_id.get(target, []):
                if target_id == row["id"]:
                    continue
                explicit_targets.add(target_id)
                _edge(
                    conn,
                    row["id"],
                    target_id,
                    link.get("type") or "RELATED",
                    1.0,
                    f"explicit link to {target}",
                    "explicit_link",
                )
        method = "commit_ref" if (attributes.get("format") == "code" or row["source"] == "git") else "id_mention_regex"
        confidence = 0.8 if method == "commit_ref" else 0.6
        for token in set(ID_RE.findall(f"{row['title'] or ''}\n{row['body'] or ''}")):
            for target_id in by_source_id.get(token, []):
                if target_id == row["id"] or target_id in explicit_targets:
                    continue
                _edge(
                    conn,
                    row["id"],
                    target_id,
                    "MENTIONS",
                    confidence,
                    f"matched {token}",
                    method,
                )
        _duplicates_for(conn, row, entities)
    _recompute_conflicts(conn)


def _duplicates_for(conn, row, entities) -> None:
    for other in entities:
        if other["id"] == row["id"]:
            continue
        if not row["body"] or not other["body"]:
            continue
        if row["body_hash"] and row["body_hash"] == other["body_hash"]:
            method, confidence, evidence = "content_hash", 1.0, "identical normalized body"
        else:
            score = jaccard(row["body"], other["body"])
            shorter = min(len((row["body"] or "").split()), len((other["body"] or "").split()))
            if score < 0.82 or shorter < 12:
                continue
            method, confidence, evidence = "near_duplicate", round(score, 2), f"jaccard {score:.2f}"
        duplicate, canonical = _orient(row, other)
        if duplicate["id"] != row["id"]:
            continue
        _edge(conn, duplicate["id"], canonical["id"], "DUPLICATE_OF", confidence, evidence, method)


def _orient(left, right):
    left_rank = left["authority_rank"] if left["authority_rank"] is not None else 50
    right_rank = right["authority_rank"] if right["authority_rank"] is not None else 50
    if left_rank != right_rank:
        if left_rank < right_rank:
            return right, left
        return left, right
    if left["id"] <= right["id"]:
        return right, left
    return left, right


def _edge(conn, from_id, to_id, edge_type, confidence, evidence, method) -> None:
    conn.execute(
        """
        INSERT INTO edge (from_id, to_id, type, confidence, evidence, method, active)
        VALUES (%s, %s, %s, %s, %s, %s, TRUE)
        ON CONFLICT (from_id, to_id, type) DO UPDATE
        SET confidence = EXCLUDED.confidence,
            evidence = EXCLUDED.evidence,
            method = EXCLUDED.method,
            active = TRUE
        """,
        (from_id, to_id, edge_type, confidence, evidence, method),
    )


def _recompute_conflicts(conn) -> None:
    conn.execute("DELETE FROM conflict WHERE resolved = FALSE")
    rows = conn.execute(
        """
        SELECT id, source, logical_key, attributes, authority_rank
        FROM entity
        WHERE deleted = FALSE AND status = 'active' AND logical_key IS NOT NULL
        """
    ).fetchall()
    groups: dict[str, list] = {}
    for row in rows:
        threshold = (row["attributes"] or {}).get("threshold_usd")
        if threshold is None:
            continue
        groups.setdefault(row["logical_key"], []).append(row)
    for logical_key, items in groups.items():
        distinct = {str(item["attributes"]["threshold_usd"]) for item in items}
        if len(distinct) < 2:
            continue
        entity_type = policy_type(logical_key)

        def sort_key(item, entity_type=entity_type):
            return (_rank(conn, entity_type, item["source"]), item["id"])

        winner = min(items, key=sort_key)
        winner_value = str(winner["attributes"]["threshold_usd"])
        for loser in items:
            loser_value = str(loser["attributes"]["threshold_usd"])
            if loser["id"] == winner["id"] or loser_value == winner_value:
                continue
            conn.execute(
                """
                INSERT INTO conflict (
                  logical_key, field, winner_id, loser_id, winner_value, loser_value,
                  winner_source, loser_source
                ) VALUES (%s, 'threshold_usd', %s, %s, %s, %s, %s, %s)
                """,
                (
                    logical_key,
                    winner["id"],
                    loser["id"],
                    winner_value,
                    loser_value,
                    winner["source"],
                    loser["source"],
                ),
            )
