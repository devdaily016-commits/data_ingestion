"""Agent retrieval contract. No model is called."""

from pipeline.logic import ID_RE, embed, vector_literal
from hub.db import pool


CONTRACT = "context-hub.v1"


def build_context(query: str, user: str, limit: int = 8) -> dict:
    question = (query or "").strip()
    if not question:
        return {
            "query": question,
            "user": user,
            "contract": CONTRACT,
            "model_called": False,
            "results": [],
            "note": "Pass a question. Nothing is retrieved for an empty query.",
        }
    identifiers = list({match for match in ID_RE.findall(question)}) or [""]
    safe = question.replace("%", "").replace("_", "")
    like = f"%{safe}%"
    lexical = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in question)
    if not lexical.strip():
        lexical = "document"
    with pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT
              c.id AS chunk_id,
              c.text,
              c.locator,
              c.ordinal,
              e.id AS entity_id,
              e.type,
              e.source,
              e.source_id,
              e.title,
              e.source_uri,
              e.source_version,
              e.modified_at,
              e.ingested_at,
              e.stale_since,
              e.authority_rank,
              e.logical_key,
              e.flags,
              e.parser_version,
              e.version,
              (
                CASE
                  WHEN e.source_id = ANY(%(ids)s) OR e.logical_key = ANY(%(ids)s) THEN 1.0
                  ELSE 0
                END
                + ts_rank(c.tsv, plainto_tsquery('english', %(lexical)s))
                + 0.35 * (1 - (c.embedding <=> %(vec)s::vector))
                + CASE WHEN e.title ILIKE %(like)s OR c.text ILIKE %(like)s THEN 0.15 ELSE 0 END
              ) AS score
            FROM chunk c
            JOIN entity e ON e.id = c.entity_id
            WHERE c.active = TRUE
              AND e.deleted = FALSE
              AND e.status = 'active'
              AND (%(principal)s = ANY(e.acl_principals) OR 'everyone' = ANY(e.acl_principals))
            ORDER BY score DESC, c.ordinal ASC
            LIMIT %(limit)s
            """,
            {
                "ids": identifiers,
                "lexical": lexical,
                "vec": vector_literal(embed(question)),
                "like": like,
                "principal": user,
                "limit": limit,
            },
        ).fetchall()
        keys = [row["logical_key"] for row in rows if row["logical_key"]]
        conflicts = []
        if keys:
            conflicts = conn.execute(
                """
                SELECT logical_key, field, winner_id, loser_id, winner_value, loser_value,
                       winner_source, loser_source
                FROM conflict
                WHERE resolved = FALSE AND logical_key = ANY(%s)
                """,
                (keys,),
            ).fetchall()
    by_key: dict[str, list] = {}
    for item in conflicts:
        by_key.setdefault(item["logical_key"], []).append(dict(item))

    results = []
    for row in rows:
        related = by_key.get(row["logical_key"] or "", [])
        loser_ids = {item["loser_id"] for item in related}
        results.append(
            {
                "entity_id": row["entity_id"],
                "chunk_id": row["chunk_id"],
                "type": row["type"],
                "title": row["title"],
                "source": row["source"],
                "source_id": row["source_id"],
                "source_uri": row["source_uri"],
                "source_version": row["source_version"],
                "version": row["version"],
                "modified_at": row["modified_at"],
                "ingested_at": row["ingested_at"],
                "stale_since": row["stale_since"],
                "freshness": "stale" if row["stale_since"] else "current",
                "authority_rank": row["authority_rank"],
                "authoritative": row["entity_id"] not in loser_ids,
                "logical_key": row["logical_key"],
                "flags": row["flags"] or [],
                "locator": row["locator"],
                "excerpt": row["text"],
                "score": round(float(row["score"]), 4),
                "parser_version": row["parser_version"],
                "conflicts": related,
            }
        )
    return {
        "query": question,
        "user": user,
        "contract": CONTRACT,
        "model_called": False,
        "results": results,
        "note": (
            "This is the retrieval contract an agent would receive. "
            "No model was called. Records outside this person's permissions are omitted."
        ),
    }
