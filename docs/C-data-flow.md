# C. Data flow

## Poll, the safety net

Webhooks are fast and they get lost. Every source also has a cursor.

```mermaid
sequenceDiagram
  participant Source
  participant Connector
  participant Queue
  participant Raw
  participant Worker
  participant Hub
  Connector->>Hub: read watermark
  Connector->>Source: records changed after watermark
  Source-->>Connector: batch
  Connector->>Queue: one message per record
  Worker->>Queue: lock message
  Worker->>Raw: write payload
  Worker->>Worker: parse, hash, link, embed
  Worker->>Hub: upsert entity, chunks, edges
  Worker->>Queue: complete
  Worker->>Hub: advance watermark only after the batch settles
```

Quickbase has no dependable webhook, so the poll is the only path, with backoff when the API returns 429. SharePoint uses Graph delta. Git uses the files touched since the last indexed commit. Jira uses `updated`, and a nightly id list catches deletes the webhook missed.

## Webhook

```mermaid
sequenceDiagram
  participant Source
  participant Hub
  participant Queue
  participant Connector
  Source->>Hub: event with an id, not the whole document
  Hub->>Queue: enqueue
  Hub-->>Source: 202
  Queue->>Connector: refetch that id
  alt source is down
    Connector-->>Queue: release the lock, do not dead-letter
  else source returns the record
    Connector->>Hub: ingest
  end
```

A delete event does not need a body. The worker writes a tombstone, deactivates chunks, and leaves `entity_version` in place.

## Source outage

```mermaid
sequenceDiagram
  participant ADO
  participant Connector
  participant Hub
  Connector->>ADO: delta
  ADO-->>Connector: 503
  Connector->>Hub: failure 1, watermark unchanged
  Connector->>ADO: delta
  ADO-->>Connector: 503
  Connector->>Hub: circuit open, mark ADO rows stale
  Note over ADO: an editor changes EPIC-42
  Connector->>ADO: delta after recovery
  ADO-->>Connector: only EPIC-42
  Connector->>Hub: upsert that epic, clear stale, move watermark
```

Two failures open the circuit in this demo. Production should use a higher threshold and a half-open probe so a single blip does not stamp the corpus stale. The rule that matters is the watermark: it does not move while the fetch is failing.

## What the Context API does with a question

```mermaid
sequenceDiagram
  participant Agent
  participant API as Context API
  participant Hub
  Agent->>API: question and caller identity
  API->>Hub: hybrid search where caller is on the ACL
  Hub-->>API: chunks plus conflicts
  API-->>Agent: citations, freshness, authority, flags
  Note over Agent: A model may run later. It is not part of this request.
```

There is no generation step in this service. If the caller is Sam, a control document whose principals are only Alex and Compliance is absent from the payload, including its title.

## Duplicate and conflict

Identical normalized text becomes a `DUPLICATE_OF` edge from the lower-authority copy to the canonical one. The copy is not deleted. A later drift in the copy (Quickbase says 5000, the spreadsheet says 10000) opens a conflict. The winner is the source with the better rank for that field. Both values are returned to the agent.

Ranks live in `authority_rule`. Process Knowledge Governance owns changes to that table. The pipeline does not hard-code "SharePoint always wins" except as seed data for the demo.
