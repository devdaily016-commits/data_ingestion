"""Service Bus semantics on Postgres.

Send, lock, complete, abandon, and dead-letter. This is the local stand-in
for Azure Service Bus (including a dead-letter queue). The Microsoft emulator
needs Azure SQL Edge, which is a poor fit for Apple Silicon, so the demo
keeps the same operations here. See docs/D-design-notes.md.
"""

from psycopg.types.json import Json

from hub.config import QUEUE_MAX_ATTEMPTS
from hub.db import pool
from hub.util import json_safe


def send(payload: dict) -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """
            INSERT INTO queue_message (payload)
            VALUES (%s)
            RETURNING id
            """,
            (Json(json_safe(payload)),),
        ).fetchone()
        conn.commit()
        return row["id"]


def receive():
    with pool().connection() as conn:
        row = conn.execute(
            """
            WITH cte AS (
              SELECT id FROM queue_message
              WHERE status = 'pending' AND available_at <= now()
              ORDER BY id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE queue_message AS q
            SET status = 'inflight',
                locked_until = now() + interval '30 seconds'
            FROM cte
            WHERE q.id = cte.id
            RETURNING q.*
            """
        ).fetchone()
        conn.commit()
        return row


def complete(message_id: int) -> None:
    with pool().connection() as conn:
        conn.execute(
            "UPDATE queue_message SET status = 'done', locked_until = NULL WHERE id = %s",
            (message_id,),
        )
        conn.commit()


def abandon(message_id: int, error: str, *, fatal: bool) -> str:
    """Return 'pending' or 'dead'. Non-fatal failures (source down) do not count toward the DLQ."""
    with pool().connection() as conn:
        if not fatal:
            conn.execute(
                """
                UPDATE queue_message
                SET status = 'pending',
                    locked_until = NULL,
                    available_at = now() + interval '1 second',
                    last_error = %s
                WHERE id = %s
                """,
                (error[:500], message_id),
            )
            conn.commit()
            return "pending"
        row = conn.execute(
            """
            UPDATE queue_message
            SET attempts = attempts + 1,
                last_error = %s,
                locked_until = NULL,
                status = CASE WHEN attempts + 1 >= %s THEN 'dead' ELSE 'pending' END,
                available_at = now() + interval '200 milliseconds'
            WHERE id = %s
            RETURNING attempts, status, payload
            """,
            (error[:500], QUEUE_MAX_ATTEMPTS, message_id),
        ).fetchone()
        if row and row["status"] == "dead":
            payload = row["payload"] or {}
            record = payload.get("record") or {}
            conn.execute(
                """
                INSERT INTO dlq_item (source, payload, error, attempts, status)
                VALUES (%s, %s, %s, %s, 'open')
                """,
                (
                    record.get("source") or payload.get("source"),
                    Json(json_safe(payload)),
                    error[:500],
                    row["attempts"],
                ),
            )
        conn.commit()
        return row["status"] if row else "pending"


def pending_count() -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """
            SELECT count(*) AS n FROM queue_message
            WHERE status IN ('pending', 'inflight')
            """
        ).fetchone()
        return row["n"]


def outstanding_for_run(run_id: int) -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """
            SELECT count(*) AS n FROM queue_message
            WHERE status IN ('pending', 'inflight')
              AND payload->>'run_id' = %s
            """,
            (str(run_id),),
        ).fetchone()
        return row["n"]
