"""Postgres pool and schema bootstrap."""

from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from hub.config import database_url

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            database_url(),
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def apply_schema() -> None:
    raw = Path(__file__).with_name("schema.sql").read_text()
    statements = []
    for part in raw.split(";"):
        lines = [
            line
            for line in part.splitlines()
            if line.strip() and not line.strip().startswith("--")
        ]
        statement = "\n".join(lines).strip()
        if statement:
            statements.append(statement)
    with pool().connection() as conn:
        for statement in statements:
            conn.execute(statement)
        conn.commit()
