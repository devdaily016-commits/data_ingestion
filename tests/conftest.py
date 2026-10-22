import os

# Isolated from the demo database. Read by hub.config.database_url() on first use.
os.environ["DATABASE_URL"] = "postgresql://hub:hub@127.0.0.1:54329/contexthub_test"
os.environ.setdefault("BLOB_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "test-raw"))
