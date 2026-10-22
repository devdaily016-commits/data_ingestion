"""Raw landing zone.

The filesystem layout mirrors an ADLS Gen2 container (`raw/{source}/...`).
When Azurite is reachable, each object is also uploaded there. Reads stay on
the filesystem so a blob-emulator hiccup cannot hide already landed payloads.
"""

import json
from datetime import datetime, timezone

from hub.config import azurite_connection_string, blob_dir
from hub.util import json_safe

_mirror = None
_mirror_checked = False


def blob_backend() -> str:
    return "filesystem"


def blob_mirror() -> str:
    return "azurite" if _azurite_client() is not None else "off"


def _azurite_client():
    global _mirror, _mirror_checked
    if _mirror_checked:
        return _mirror
    _mirror_checked = True
    try:
        from azure.storage.blob import BlobServiceClient

        client = BlobServiceClient.from_connection_string(azurite_connection_string())
        try:
            client.create_container("raw")
        except Exception:
            pass
        client.get_container_client("raw").get_container_properties()
        _mirror = client
    except Exception:
        _mirror = None
    return _mirror


def put(source: str, source_id: str, version: str, payload: dict) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    safe_id = source_id.replace("/", "__")
    safe_version = str(version).replace("/", "_")
    relative = f"{source}/{safe_id}/{safe_version}-{stamp}.json"
    target = blob_dir() / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(json_safe(payload), indent=2).encode()
    target.write_bytes(data)
    client = _azurite_client()
    if client is not None:
        try:
            client.get_blob_client("raw", relative).upload_blob(data, overwrite=True)
        except Exception:
            pass
    return relative


def get(relative: str | None) -> dict | None:
    if not relative:
        return None
    target = blob_dir() / relative
    if not target.exists():
        return None
    return json.loads(target.read_text())
