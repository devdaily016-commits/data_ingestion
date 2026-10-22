"""Runtime settings. Environment wins; defaults match docker-compose."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PARSER_VERSION = "demo-parser-1"
EMBED_DIM = 64

# Open the circuit after this many consecutive fetch failures.
# Production would use a higher threshold and a half-open probe interval.
CIRCUIT_THRESHOLD = 2
QUEUE_MAX_ATTEMPTS = 3


def database_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql://hub:hub@127.0.0.1:54329/contexthub",
    )


def mock_base_url() -> str:
    return os.environ.get("MOCK_BASE_URL", "http://127.0.0.1:8001").rstrip("/")


def hub_base_url() -> str:
    return os.environ.get("HUB_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def blob_dir() -> Path:
    return Path(os.environ.get("BLOB_DIR", ROOT / "data" / "raw"))


def azurite_connection_string() -> str:
    return os.environ.get(
        "AZURITE_CONNECTION_STRING",
        (
            "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
            "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;"
            "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
        ),
    )
