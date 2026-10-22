"""Block until the demo database accepts connections."""

import os
import sys
import time

import psycopg

url = os.environ.get("DATABASE_URL", "postgresql://hub:hub@127.0.0.1:54329/contexthub")

def main() -> int:
    for _ in range(60):
        try:
            with psycopg.connect(url, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            print("database is ready")
            return 0
        except Exception as exc:
            last = exc
            time.sleep(1)
    print(f"database did not become ready: {last}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
