"""Delta poll, reconciliation, and the queue worker."""

import logging
import threading
import time

from hub.db import pool
from pipeline.ingest import ingest_record, relink_all
from pipeline.logic import PoisonRecord, SourceUnavailable
from pipeline import queue

log = logging.getLogger("pipeline")
_stop = threading.Event()


def dispatch(payload: dict) -> None:
    kind = payload.get("kind")
    if kind == "record":
        ingest_record(payload["record"], run_id=payload.get("run_id"))
        return
    if kind == "webhook":
        from connectors import materialize

        record = materialize(payload["source"], payload.get("event"), payload.get("ref"))
        ingest_record(record, run_id=payload.get("run_id"))
        return
    raise ValueError(f"unknown queue payload {kind}")


def drain(max_n: int = 50) -> int:
    handled = 0
    for _ in range(max_n):
        message = queue.receive()
        if message is None:
            break
        payload = message["payload"]
        try:
            dispatch(payload)
            queue.complete(message["id"])
        except SourceUnavailable as exc:
            queue.abandon(message["id"], str(exc), fatal=False)
        except PoisonRecord as exc:
            queue.abandon(message["id"], str(exc), fatal=True)
        except Exception as exc:
            log.exception("pipeline message %s failed", message["id"])
            queue.abandon(message["id"], str(exc), fatal=True)
        handled += 1
    return handled


def worker_loop() -> None:
    while not _stop.is_set():
        try:
            worked = drain(30)
        except Exception:
            log.exception("worker loop")
            worked = 0
        time.sleep(0.05 if worked else 0.3)


def start_worker() -> threading.Thread:
    _stop.clear()
    thread = threading.Thread(target=worker_loop, name="ingest-worker", daemon=True)
    thread.start()
    return thread


def stop_worker() -> None:
    _stop.set()


def wait_until_idle(timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(40)
        if queue.pending_count() == 0:
            return True
        time.sleep(0.05)
    return queue.pending_count() == 0


def ensure_source(conn, name: str) -> dict:
    conn.execute(
        "INSERT INTO sync_state (source) VALUES (%s) ON CONFLICT (source) DO NOTHING",
        (name,),
    )
    return conn.execute("SELECT * FROM sync_state WHERE source = %s", (name,)).fetchone()


def poll_source(name: str, connector=None) -> dict:
    from connectors import get_connector
    from hub.util import parse_dt

    connector = connector or get_connector(name)
    with pool().connection() as conn:
        state = ensure_source(conn, name)
        watermark = state["watermark"]
        conn.commit()
    try:
        records = connector.fetch_delta(watermark)
    except SourceUnavailable as exc:
        _fail_source(name, str(exc))
        return {"ok": False, "source": name, "error": str(exc)}

    run_id = _start_run(name, "poll")
    for record in records:
        queue.send({"kind": "record", "run_id": run_id, "record": record})
    _wait_for_run(run_id)
    failed = _dead_for_run(run_id)
    outstanding = queue.outstanding_for_run(run_id)
    new_watermark = watermark
    if records and outstanding == 0:
        times = [parse_dt(record.get("modified_at")) for record in records]
        times = [item for item in times if item is not None]
        if times:
            candidate = max(times)
            if watermark is None or candidate > watermark:
                new_watermark = candidate
    _succeed_source(name, new_watermark, advance=outstanding == 0)
    _finish_run(run_id, "completed" if outstanding == 0 else "partial", None)
    with pool().connection() as conn:
        relink_all(conn)
        conn.commit()
    return {
        "ok": True,
        "source": name,
        "received": len(records),
        "failed": failed,
        "watermark": new_watermark.isoformat() if hasattr(new_watermark, "isoformat") else new_watermark,
    }


def reconcile_source(name: str, connector=None) -> dict:
    from connectors import get_connector

    connector = connector or get_connector(name)
    live = set(connector.list_ids())
    with pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT source_id FROM entity
            WHERE source = %s AND deleted = FALSE AND status = 'active'
            """,
            (name,),
        ).fetchall()
    missing = [row["source_id"] for row in rows if row["source_id"] not in live]
    for source_id in missing:
        ingest_record(
            {
                "source": name,
                "source_id": source_id,
                "type": "record",
                "title": "",
                "body": "",
                "format": "record",
                "deleted": True,
                "acl": [],
                "attributes": {},
                "source_version": "reconcile",
                "uri": "",
                "logical_key": None,
                "raw": {"reason": "missing from source id list"},
            }
        )
    return {"ok": True, "source": name, "tombstoned": missing}


def _fail_source(name: str, error: str) -> None:
    with pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO sync_state (source, failure_count, status, circuit, last_error, last_sync_at)
            VALUES (%s, 1, 'error', 'closed', %s, now())
            ON CONFLICT (source) DO UPDATE SET
              failure_count = sync_state.failure_count + 1,
              last_error = EXCLUDED.last_error,
              last_sync_at = now(),
              status = CASE WHEN sync_state.failure_count + 1 >= 2 THEN 'degraded' ELSE 'error' END,
              circuit = CASE WHEN sync_state.failure_count + 1 >= 2 THEN 'open' ELSE sync_state.circuit END
            """,
            (name, error[:500]),
        )
        conn.execute(
            """
            UPDATE entity
            SET stale_since = COALESCE(stale_since, now())
            WHERE source = %s AND deleted = FALSE AND status = 'active'
              AND EXISTS (
                SELECT 1 FROM sync_state WHERE source = %s AND circuit = 'open'
              )
            """,
            (name, name),
        )
        conn.commit()


def _succeed_source(name: str, watermark, advance: bool) -> None:
    with pool().connection() as conn:
        count = conn.execute(
            """
            SELECT count(*) AS n FROM entity
            WHERE source = %s AND deleted = FALSE AND status = 'active'
            """,
            (name,),
        ).fetchone()["n"]
        if advance:
            conn.execute(
                """
                UPDATE sync_state
                SET watermark = %s,
                    last_sync_at = now(),
                    status = 'healthy',
                    circuit = 'closed',
                    failure_count = 0,
                    last_error = NULL,
                    entity_count = %s
                WHERE source = %s
                """,
                (watermark, count, name),
            )
            conn.execute(
                "UPDATE entity SET stale_since = NULL WHERE source = %s",
                (name,),
            )
        else:
            conn.execute(
                """
                UPDATE sync_state
                SET last_sync_at = now(),
                    entity_count = %s,
                    last_error = 'batch still retrying; watermark held'
                WHERE source = %s
                """,
                (count, name),
            )
        conn.commit()


def _start_run(source: str, mode: str) -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """
            INSERT INTO ingest_run (source, mode, status)
            VALUES (%s, %s, 'running')
            RETURNING id
            """,
            (source, mode),
        ).fetchone()
        conn.commit()
        return row["id"]


def _finish_run(run_id: int, status: str, error: str | None) -> None:
    with pool().connection() as conn:
        conn.execute(
            """
            UPDATE ingest_run
            SET finished_at = now(), status = %s, error = %s
            WHERE id = %s
            """,
            (status, error, run_id),
        )
        conn.commit()


def _wait_for_run(run_id: int, timeout: float = 8.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain(40)
        if queue.outstanding_for_run(run_id) == 0:
            return
        time.sleep(0.05)


def _dead_for_run(run_id: int) -> int:
    with pool().connection() as conn:
        row = conn.execute(
            """
            SELECT count(*) AS n FROM queue_message
            WHERE status = 'dead' AND payload->>'run_id' = %s
            """,
            (str(run_id),),
        ).fetchone()
        return row["n"]
