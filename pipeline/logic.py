"""Pure parsing, hashing, embedding, and safety checks.

No database and no network. Production swaps the parsers and the embedding
function; the decisions (what is a chunk, what is quarantined) stay here.
"""

import ast
import hashlib
import re

from hub.config import EMBED_DIM

ID_RE = re.compile(
    r"\b(BR-\d+|JIRA-\d+|EPIC-\d+|FEAT-\d+|MT-\d+|RULE-\d+|SOC-\d+|SRTS-\d+|JA-\d+|QB-\d+|MTG-[\d-]+|AS-\d+)\b"
)

INJECTION_PATTERNS = (
    re.compile(r"ignore (all |any )?(previous|prior) instructions", re.I),
    re.compile(r"you are now", re.I),
    re.compile(r"disregard (the )?(system|safety|policy)", re.I),
    re.compile(r"<\s*/?\s*system\s*>", re.I),
)

SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")

# Which authority table applies when two sources disagree about a field.
FIELD_POLICY = {
    "threshold_usd": {
        "default": "business_requirement",
        "RULE-": "config_rule",
    }
}

LINK_METHODS = (
    "explicit_link",
    "id_mention_regex",
    "commit_ref",
    "content_hash",
    "near_duplicate",
)


class PoisonRecord(Exception):
    """A payload that fails processing on purpose, to exercise the dead-letter path."""


class SourceUnavailable(Exception):
    """The source could not be read. Retry, do not dead-letter."""


def norm_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def content_hash(title: str | None, body: str | None, threshold) -> str:
    raw = f"{title or ''}\n{body or ''}\n{threshold if threshold is not None else ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def body_hash(body: str | None) -> str:
    return hashlib.sha256(norm_text(body).encode()).hexdigest()


def tokens(text: str | None) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", norm_text(text)))


def jaccard(left: str | None, right: str | None) -> float:
    a, b = tokens(left), tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def detect_injection(text: str | None) -> bool:
    sample = text or ""
    return any(pattern.search(sample) for pattern in INJECTION_PATTERNS)


def detect_pii(text: str | None) -> list[str]:
    sample = text or ""
    found = []
    if SSN_RE.search(sample):
        found.append("ssn")
    if EMAIL_RE.search(sample):
        found.append("email")
    return found


def embed(text: str | None) -> list[float]:
    """Deterministic hashing-trick embedding.

    Azure OpenAI embeddings replace this in production. The dimension and the
    call site stay the same so retrieval code does not care which model ran.
    """
    vector = [0.0] * EMBED_DIM
    for token in tokens(text):
        digest = hashlib.sha256(token.encode()).digest()
        index = digest[0] % EMBED_DIM
        sign = 1.0 if digest[1] % 2 == 0 else -1.0
        vector[index] += sign
    norm = sum(value * value for value in vector) ** 0.5
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in values) + "]"


def policy_type(logical_key: str | None) -> str:
    key = logical_key or ""
    for prefix, entity_type in FIELD_POLICY["threshold_usd"].items():
        if prefix != "default" and key.startswith(prefix):
            return entity_type
    return FIELD_POLICY["threshold_usd"]["default"]


def chunks_for(record: dict) -> list[dict]:
    fmt = record.get("format") or "record"
    body = record.get("body") or ""
    title = record.get("title") or ""
    attributes = record.get("attributes") or {}
    if fmt == "markdown":
        return _split_markdown(title, body, record.get("source_id"))
    if fmt == "code":
        return _split_python(body, attributes.get("path") or record.get("source_id"))
    if fmt == "transcript":
        return _split_vtt(body)
    if fmt == "spreadsheet_row":
        return [
            {
                "ordinal": 0,
                "text": f"{title}\n{body}".strip(),
                "locator": {
                    "sheet": attributes.get("sheet") or "Rules",
                    "row": attributes.get("row"),
                    "cell": attributes.get("cell"),
                },
            }
        ]
    return [
        {
            "ordinal": 0,
            "text": f"{title}\n{body}".strip(),
            "locator": {"section": record.get("source_id")},
        }
    ]


def _split_markdown(title: str, body: str, source_id: str | None) -> list[dict]:
    parts = re.split(r"(?m)^(#{1,3} .+)$", body)
    chunks = []
    heading = title or source_id or "section"
    buffer = []
    for part in parts:
        if part.startswith("#"):
            if buffer:
                text = "\n".join(buffer).strip()
                if text:
                    chunks.append(
                        {
                            "ordinal": len(chunks),
                            "text": text,
                            "locator": {"section": heading, "kind": "markdown"},
                        }
                    )
            heading = part.lstrip("#").strip()
            buffer = [part]
        else:
            buffer.append(part)
    tail = "\n".join(buffer).strip()
    if tail:
        chunks.append(
            {
                "ordinal": len(chunks),
                "text": tail,
                "locator": {"section": heading, "kind": "markdown"},
            }
        )
    if not chunks:
        chunks.append(
            {
                "ordinal": 0,
                "text": f"{title}\n{body}".strip(),
                "locator": {"section": source_id, "kind": "markdown"},
            }
        )
    return chunks


def _split_python(source: str, path: str | None) -> list[dict]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return [
            {
                "ordinal": 0,
                "text": source,
                "locator": {"path": path, "kind": "file"},
            }
        ]
    lines = source.splitlines()
    chunks = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        start = node.lineno
        end = getattr(node, "end_lineno", start)
        text = "\n".join(lines[start - 1 : end]).strip()
        chunks.append(
            {
                "ordinal": len(chunks),
                "text": text,
                "locator": {
                    "path": path,
                    "symbol": node.name,
                    "kind": type(node).__name__,
                    "line_start": start,
                    "line_end": end,
                },
            }
        )
    if not chunks:
        chunks.append(
            {
                "ordinal": 0,
                "text": source,
                "locator": {"path": path, "kind": "file"},
            }
        )
    return chunks


def _split_vtt(body: str) -> list[dict]:
    pattern = re.compile(
        r"(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s*\n(.+?)(?=\n\s*\n|\Z)",
        re.S,
    )
    chunks = []
    for match in pattern.finditer(body):
        text = " ".join(match.group(3).split())
        chunks.append(
            {
                "ordinal": len(chunks),
                "text": text,
                "locator": {
                    "kind": "cue",
                    "start": match.group(1),
                    "end": match.group(2),
                },
            }
        )
    if not chunks:
        chunks.append(
            {
                "ordinal": 0,
                "text": body.strip(),
                "locator": {"kind": "transcript"},
            }
        )
    return chunks
