# Context Hub ingestion demo

The agent is only as careful as the data under it. This project turns the first architecture sketch into a pipeline: connectors, an immutable raw zone, a canonical Context Hub, and a retrieval contract. It does not include a chatbot.

The assessment write-up is in [docs/](docs/):

- [A. Architecture](docs/A-architecture.md)
- [B. Technology stack](docs/B-technology-stack.md)
- [C. Data flow](docs/C-data-flow.md)
- [D. Design notes](docs/D-design-notes.md) (assumptions, trade-offs, security, open questions)
- [E. Roadmap](docs/E-roadmap.md)
- [F. Testing](docs/F-testing.md)
- [G. Console walkthrough](docs/G-console-walkthrough.md)

## Run the console

Requirements: Docker, Python 3.11 or newer, Node 18 or newer.

```bash
make demo
```

Open http://127.0.0.1:5173. The first sync takes a few seconds. Postgres is published on port **54329** so it does not collide with a local database.

`make test` starts Postgres and runs the pipeline tests. `make reset` deletes the database volume and the local raw zone.

## What to click

A screen-by-screen tour for someone new to the console is in [docs/G-console-walkthrough.md](docs/G-console-walkthrough.md).

The corpus is one rule, traced on purpose. `BR-101` says claims at or above $10,000 need two approvers. The situations in the left rail walk the failure cases:

1. **Change JIRA-501.** One story is re-read and versioned. Nothing else is copied.
2. **Delete BR-102.** SharePoint delete becomes a tombstone. The old text stays in Versions.
3. **Take ADO offline**, then **Edit EPIC-42 during the outage**, then **Restore ADO and catch up.** The watermark stays put while ADO is down. Catch-up brings back the epic edit only.
4. **Drift the Quickbase copy.** Operations now says $5,000. The finance spreadsheet stays authoritative. Both numbers remain visible.
5. **Quarantine a hidden instruction.** The file is kept in the raw zone and kept out of the Context API.
6. **Remove Sam from BR-101.** On the Context API screen, ask the same question as Sam and as Alex.
7. **Send a poison payload**, then **Replay the oldest dead letter.**

The Context API screen is the payload an agent would get. The model is not called.

## Layout

- `mock_sources/` — Jira, Azure DevOps, SharePoint, Quickbase, Git, and the other catalogs, with outage switches.
- `connectors/` — one mapper and client per source.
- `pipeline/` — queue, raw zone, parse, upsert, links, conflicts, retrieval.
- `hub/` — schema and the API.
- `dashboard/` — the operator console.
- `tests/` — idempotency, deletes, outages, duplicates, conflicts, and access trimming.

The laptop services stand in for Azure. The mapping is in [docs/A-architecture.md](docs/A-architecture.md). Production choices and the alternatives I would still consider are in [docs/B-technology-stack.md](docs/B-technology-stack.md).
