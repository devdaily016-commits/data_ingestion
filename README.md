# Context Hub — Enterprise Data Ingestion Pipeline

> A working, end-to-end ingestion pipeline that pulls knowledge from many enterprise systems (Jira, Azure DevOps, SharePoint, Quickbase, Git, spreadsheets, transcripts and more) into one trusted **Context Hub** — with versioning, deletes, outages, conflicts, permissions and audit handled properly.

This project turns a first-iteration architecture sketch into a real pipeline: **connectors → queue → immutable raw zone → parse / normalize / enrich → Context Hub → Context API**. It ships with an operator console that lets you trigger real failure scenarios and watch the pipeline handle them.

> **Note:** This project does **not** include a chatbot and never calls an LLM. The Context API screen shows the exact JSON payload an AI agent *would* receive.

---

## Table of Contents

1. [Key Features](#1-key-features)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Prerequisites](#5-prerequisites)
6. [Quick Start (macOS / Linux)](#6-quick-start-macos--linux)
7. [Manual Setup (Windows, or without `make`)](#7-manual-setup-windows-or-without-make)
8. [Verify the Installation](#8-verify-the-installation)
9. [Services and Ports](#9-services-and-ports)
10. [Configuration](#10-configuration)
11. [Make Commands](#11-make-commands)
12. [Running the Tests](#12-running-the-tests)
13. [Guided Demo: Failure Scenarios](#13-guided-demo-failure-scenarios)
14. [API Reference](#14-api-reference)
15. [Data Model](#15-data-model)
16. [Troubleshooting](#16-troubleshooting)
17. [Stopping and Resetting](#17-stopping-and-resetting)
18. [Further Documentation](#18-further-documentation)

---

## 1. Key Features

| Capability | What it means in practice |
| --- | --- |
| **12 source connectors** | Jira, Azure DevOps, SharePoint, Quickbase, Git, rule workbook (Excel), manual tests, meeting transcripts, job aids, AndiSense, SOC controls, SRTS — each with its own mapper and client. |
| **Webhooks + delta polling** | Webhooks carry only a key; the connector re-reads that one record. Polls ask only for records changed after a stored **watermark**. |
| **Immutable raw zone** | Every payload is written to disk (and mirrored to Azurite blob storage) *before* it is interpreted, so failures can be replayed without calling the source again. |
| **Idempotent upserts** | A content hash + access list check means unchanged records are never rewritten. A catch-up poll does not copy the whole corpus again. |
| **Full version history** | Every content change writes a new version. Old versions are always kept. |
| **Deletes as tombstones** | Deleted records leave the agent index but stay in history for audit. Reconciliation catches deletes that webhooks missed. |
| **Outage handling** | A circuit breaker opens after two failed polls, records are marked stale, and the watermark freezes until the source recovers. |
| **Conflict resolution** | When sources disagree (e.g. $10,000 vs $5,000), an **authority table** decides the winner. Both values stay visible. |
| **Duplicate detection** | Identical content across sources is linked with `DUPLICATE_OF` edges, not deleted. |
| **Prompt-injection quarantine** | Hidden instructions in source text are quarantined: kept in the raw zone, kept out of the Context API. |
| **PII flagging** | Personal data is flagged and left visible only to people allowed to see the source. |
| **Permission trimming** | The Context API returns only what the requesting user is allowed to see. |
| **Dead-letter queue** | Messages that fail three times move to a dead-letter queue and can be replayed. |
| **Lineage & audit** | Every pipeline stage writes a lineage event you can trace per record. |
| **Hybrid retrieval** | Keyword search (Postgres `tsvector`) plus vector search (`pgvector`). |

---

## 2. Architecture

### Implemented design

```mermaid
flowchart LR
  subgraph sources ["Source systems (mock_sources)"]
    Jira["Jira"]
    ADO["Azure DevOps"]
    SharePoint["SharePoint"]
    Quickbase["Quickbase"]
    Git["Git"]
    Rules["Rule workbook"]
    Other["Tests, transcripts, job aids,<br/>AndiSense, SOCs, SRTS"]
  end
  subgraph connect ["Connectors (connectors)"]
    Hooks["Webhooks"]
    Polls["Delta polls + watermark"]
  end
  Queue["Postgres queue<br/>+ dead-letter path"]
  Raw[("Immutable raw zone<br/>data/raw + Azurite")]
  subgraph workers ["Pipeline workers (pipeline)"]
    Parse["Parse into chunks"]
    Normalize["Normalize + hash"]
    Enrich["Link, dedupe,<br/>safety checks, embed"]
  end
  subgraph hub ["Context Hub (Postgres + pgvector)"]
    Records["Entities, versions, ACLs"]
    Index["Keyword + vector index"]
    Lineage["Lineage and audit"]
  end
  API["Context API<br/>/api/context"]
  Console["Operator console<br/>(dashboard)"]

  sources --> Hooks
  sources --> Polls
  Hooks --> Queue
  Polls --> Queue
  Queue --> Raw --> Parse --> Normalize --> Enrich
  Enrich --> Records
  Enrich --> Index
  workers --> Lineage
  Records --> API
  Index --> API
  API --> Console
```

### How a record moves through the pipeline

1. A **connector** receives a webhook, or polls the source using the stored watermark.
2. The payload is put on the **queue** and written to the **raw zone** before anything else happens.
3. A **parser** splits it into chunks — a document heading, a spreadsheet cell, a Python function, or a transcript cue.
4. The worker computes a **content hash**. If the hash and access list match what is already stored, it stops (no duplicate write).
5. **Safety checks** run: hidden instructions are quarantined, personal data is flagged.
6. **Enrichment** adds links between records, detects duplicates, recomputes conflicts and creates embeddings.
7. The record is stored in the **Context Hub**, and every stage writes a **lineage event**.
8. The **Context API** serves permission-trimmed chunks to an agent.

### Original sketch

The project responds to this first-iteration diagram ([`High_LEVEL_ARC.png`](High_LEVEL_ARC.png)). The full assignment brief is in [`Background.MD`](Background.MD), and what changed from the sketch is explained in [docs/A-architecture.md](docs/A-architecture.md).

![Original first-iteration architecture sketch](High_LEVEL_ARC.png)

---

## 3. Tech Stack

The laptop services stand in for Azure services. The production mapping is in [docs/B-technology-stack.md](docs/B-technology-stack.md).

| Layer | Used in this project | Production equivalent |
| --- | --- | --- |
| Backend API | Python 3.11+, FastAPI, Uvicorn | Azure Container Apps / App Service |
| Database | PostgreSQL 16 + `pgvector` (Docker) | Azure Database for PostgreSQL |
| Raw zone | Local filesystem `data/raw`, mirrored to **Azurite** | ADLS Gen2 / Blob Storage |
| Queue | Postgres-backed queue (`pipeline/queue.py`) with lock, complete, abandon, dead-letter | Azure Service Bus |
| Source systems | FastAPI mock server (`mock_sources/`) | Real Jira, ADO, SharePoint (Graph), Quickbase, Git APIs |
| Search | Postgres full-text (`tsvector`) + `pgvector` (64-dim demo hash embedding) | Hybrid search with a real embedding model |
| Frontend | React 18 + Vite 5 | Static web hosting |
| Python libraries | `httpx`, `psycopg` 3 + `psycopg-pool`, `openpyxl`, `azure-storage-blob`, `pytest` | — |

---

## 4. Project Structure

```
data_ingestion/
├── connectors/              # One client + mapper per source system
│   ├── client.py            #   Connector classes, SOURCE_ORDER, HTTP calls to sources
│   └── mappers.py           #   Source payload → canonical record
├── dashboard/               # Operator console (React + Vite)
│   ├── src/screens/         #   Sources, Pipeline, Inspector, Trace, Quality, Context API
│   ├── src/present/         #   "Present the flow" animated walkthrough mode
│   └── vite.config.js       #   Dev server on :5173, proxies /api → :8000
├── docs/                    # Architecture & design write-up (A–G)
├── hub/                     # Context Hub service
│   ├── app.py               #   FastAPI app: pipeline control, inspection, Context API, scenarios
│   ├── config.py            #   Environment settings and defaults
│   ├── db.py                #   Connection pool + schema bootstrap
│   └── schema.sql           #   All tables + authority rules seed data
├── mock_sources/            # Fake Jira, ADO, SharePoint, Quickbase, Git, etc.
│   ├── app.py               #   Source APIs + /control endpoints (outage, mutate, add)
│   └── seed.py              #   The demo corpus (Northwind Mutual / ClaimPath)
├── pipeline/                # The ingestion engine
│   ├── queue.py             #   Queue with retries and dead-letter
│   ├── blob.py              #   Raw zone (filesystem + Azurite mirror)
│   ├── ingest.py            #   Parse, upsert, version, tombstone, link, conflicts
│   ├── logic.py             #   Hashing, chunking, PII & injection detection, embeddings
│   ├── sync.py              #   Polling, reconciliation, circuit breaker, worker loop
│   └── context.py           #   Permission-trimmed retrieval for the Context API
├── scripts/
│   ├── demo.sh              #   Starts mock sources, hub and console together
│   └── wait_for_db.py       #   Waits until Postgres accepts connections
├── tests/                   # Pipeline, mapper and logic tests (pytest)
├── docker-compose.yml       # Postgres (pgvector) + Azurite
├── Makefile                 # demo / up / test / down / reset
├── requirements.txt         # Python dependencies
├── .env.example             # Default environment variables
├── Background.MD            # Original assessment brief
└── High_LEVEL_ARC.png       # Original architecture sketch
```

---

## 5. Prerequisites

Install these before you start, then run the check command to confirm each one.

| Tool | Version | Check command | Download |
| --- | --- | --- | --- |
| **Git** | any | `git --version` | https://git-scm.com/downloads |
| **Docker Desktop** (or Docker Engine + Compose) | recent | `docker --version` and `docker compose version` | https://www.docker.com/products/docker-desktop |
| **Python** | **3.11 or newer** | `python3 --version` (Windows: `python --version`) | https://www.python.org/downloads |
| **Node.js** (includes npm) | **18 or newer** | `node --version` and `npm --version` | https://nodejs.org |
| **make** | any | `make --version` | macOS: `xcode-select --install` · Ubuntu/Debian: `sudo apt install make` · Windows: not needed, use [Section 7](#7-manual-setup-windows-or-without-make) |

> ⚠️ **Docker must be running** (Docker Desktop open, whale icon steady) before any of the steps below.

---

## 6. Quick Start (macOS / Linux)

This is the fastest way. One command starts everything.

### Step 1 — Clone the repository

```bash
git clone https://github.com/devdaily016-commits/data_ingestion.git
cd data_ingestion
```

### Step 2 — Start the full demo

```bash
make demo
```

This single command does the following, in order:

1. Creates a Python virtual environment in `.venv/` and installs `requirements.txt`.
2. Starts **Postgres** (port `54329`) and **Azurite** (port `10000`) with `docker compose up -d`.
3. Waits until the database is ready (`database is ready`).
4. Runs `npm install` inside `dashboard/`.
5. Starts the **mock source systems** (`:8001`), the **Context Hub API** (`:8000`) and the **operator console** (`:5173`).

When you see this line, it is running:

```
Context Hub console: http://127.0.0.1:5173
```

### Step 3 — Open the console

Open **http://127.0.0.1:5173** in your browser.

On startup the hub syncs all 12 sources automatically. The first sync takes a few seconds; the stats strip at the top fills in when it is done.

### Step 4 — Stop

Press **`Ctrl + C`** in the terminal. This stops the Python services and the console. The Docker containers keep running in the background — stop them with `make down` (see [Section 17](#17-stopping-and-resetting)).

---

## 7. Manual Setup (Windows, or without `make`)

`make` and `scripts/demo.sh` are written for macOS/Linux. On **Windows** (PowerShell or CMD), or if you prefer to run each part yourself, follow these steps. You will use **three terminals** at the end.

> The default settings in `hub/config.py` already match `docker-compose.yml`, so **no environment variables are required** for a local run.

### Step 1 — Clone the repository

```powershell
git clone https://github.com/devdaily016-commits/data_ingestion.git
cd data_ingestion
```

### Step 2 — Start Postgres and Azurite

```powershell
docker compose up -d
```

Confirm both containers are up:

```powershell
docker compose ps
```

You should see `postgres` (healthy) and `azurite` running. **Start both** — see [Troubleshooting](#16-troubleshooting) for why Azurite matters.

### Step 3 — Create the Python virtual environment and install dependencies

**Windows (PowerShell / CMD):**

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
```

**macOS / Linux:**

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

### Step 4 — Wait for the database

**Windows:** `.venv\Scripts\python scripts\wait_for_db.py`
**macOS / Linux:** `.venv/bin/python scripts/wait_for_db.py`

Expected output:

```
database is ready
```

### Step 5 — Install the console's packages

```powershell
cd dashboard
npm install
cd ..
```

> `npm install` may print `npm audit` warnings. These are normal for a dev setup and do not stop the project from running.

### Step 6 — Start the three services (in this order)

Run each command in its **own terminal**, from the project root folder (`data_ingestion/`).

**Terminal 1 — Mock source systems (port 8001):**

```powershell
# Windows
.venv\Scripts\python -m mock_sources
# macOS / Linux
.venv/bin/python -m mock_sources
```

Wait for: `Uvicorn running on http://127.0.0.1:8001`

**Terminal 2 — Context Hub API (port 8000):**

```powershell
# Windows
.venv\Scripts\python -m hub
# macOS / Linux
.venv/bin/python -m hub
```

Wait for: `Uvicorn running on http://127.0.0.1:8000`. On startup the hub creates the database tables and syncs every source.

> Start Terminal 1 **before** Terminal 2. The hub waits about 10 seconds for the mock sources; if they are not up, it skips the initial sync. If that happens, restart the hub, or click **Sync** for each source on the console's Sources screen.

**Terminal 3 — Operator console (port 5173):**

```powershell
cd dashboard
npm run dev
```

Wait for: `Local: http://localhost:5173/`

### Step 7 — Open the console

Open **http://127.0.0.1:5173** in your browser.

To stop, press `Ctrl + C` in each terminal, then run `docker compose down`.

---

## 8. Verify the Installation

### 1. Health check

Open **http://127.0.0.1:8000/api/health** (or run `curl http://127.0.0.1:8000/api/health`). A healthy system returns:

```json
{"ok": true, "db": true, "db_error": null, "mock": true, "blob_backend": "filesystem", "blob_mirror": "azurite"}
```

| Field | Should be | If not |
| --- | --- | --- |
| `ok` | `true` | Check the two fields below. |
| `db` | `true` | Postgres is not running → `docker compose up -d`. |
| `mock` | `true` | Mock sources are not running → start Terminal 1. |
| `blob_mirror` | `"azurite"` | `"off"` means Azurite is not running. The project still works (raw files go to `data/raw`), but start Azurite for the full setup. |

### 2. Console stats

On a **fresh** demo, before you click anything, the stats strip under the header should look like this. These non-zero numbers are expected — they are built into the seed data on purpose.

| Stat | Expected | Why |
| --- | --- | --- |
| Active | 18 | Records that ingested cleanly (19 entities in total). |
| Stale | 0 | No source is offline yet. |
| Conflicts | 1 | Jira draft `JIRA-502` says $5,000; SharePoint `BR-101` says $10,000 and wins. |
| Duplicates | 2 | `QB-9` copies `RULE-17`; `AS-44` copies `JA-12`. |
| Quarantine | 1 | Job aid `JA-99` already contains a hidden instruction. |
| Dead letters | 0 | Empty until you send the poison payload. |
| Queued | 0 | The worker has drained the queue. |

### 3. Interactive API docs

FastAPI's Swagger UI is available at **http://127.0.0.1:8000/docs** — you can call every endpoint from the browser.

---

## 9. Services and Ports

| Service | URL | Started by | Purpose |
| --- | --- | --- | --- |
| Operator console | http://127.0.0.1:5173 | `npm run dev` (in `dashboard/`) | The UI. Proxies `/api/*` to the hub. |
| Context Hub API | http://127.0.0.1:8000 | `python -m hub` | Pipeline, inspection and the Context API. |
| API docs (Swagger) | http://127.0.0.1:8000/docs | `python -m hub` | Interactive endpoint explorer. |
| Mock source systems | http://127.0.0.1:8001 | `python -m mock_sources` | Fake Jira, ADO, SharePoint, Quickbase, Git, etc. |
| PostgreSQL + pgvector | `127.0.0.1:54329` | `docker compose` | Database `contexthub`, user `hub`, password `hub`. |
| Azurite (Blob) | `127.0.0.1:10000` | `docker compose` | Local Azure Blob Storage mirror of the raw zone. |

> Postgres runs on port **54329** (not the default 5432) so it does not clash with a Postgres already installed on your machine.

Connect to the database directly if you want to look around:

```bash
psql postgresql://hub:hub@127.0.0.1:54329/contexthub
```

---

## 10. Configuration

All settings are read from environment variables. The defaults (in `hub/config.py`, `Makefile` and `.env.example`) work out of the box with `docker-compose.yml`, so you only need these if you change ports or hosts.

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://hub:hub@127.0.0.1:54329/contexthub` | Postgres connection string. |
| `MOCK_BASE_URL` | `http://127.0.0.1:8001` | Where the hub finds the mock source systems. |
| `HUB_BASE_URL` | `http://127.0.0.1:8000` | Base URL of the hub API. |
| `BLOB_DIR` | `./data/raw` | Folder for the raw landing zone. |
| `MOCK_STATE` | `./data/mock_state.json` | Where the mock sources save their current state between restarts. |
| `AZURITE_CONNECTION_STRING` | Azurite's standard local dev connection string | Blob mirror target. |

To override a value:

```bash
# macOS / Linux
export DATABASE_URL=postgresql://hub:hub@127.0.0.1:54329/contexthub
```

```powershell
# Windows PowerShell
$env:DATABASE_URL = "postgresql://hub:hub@127.0.0.1:54329/contexthub"
```

Tuning constants live in `hub/config.py`: `CIRCUIT_THRESHOLD = 2` (failed polls before the circuit opens) and `QUEUE_MAX_ATTEMPTS = 3` (attempts before a message is dead-lettered).

---

## 11. Make Commands

| Command | What it does |
| --- | --- |
| `make venv` | Create `.venv/` and install Python dependencies. |
| `make up` | `venv` + start Postgres and Azurite + wait for the database. |
| `make demo` | `up` + `npm install` + start mock sources, hub and console. |
| `make test` | `up` + run the full test suite with pytest. |
| `make down` | Stop the Docker containers (data is kept). |
| `make reset` | Stop containers, **delete the database volume** and the local `data/` folder. |

---

## 12. Running the Tests

The suite has **12 tests** across three files. The pipeline tests run against a separate database, `contexthub_test`, which is created and wiped automatically — your demo data is never touched.

**With make:**

```bash
make test
```

**Without make** (Postgres and Azurite must be running — `docker compose up -d`):

```bash
# macOS / Linux
.venv/bin/python -m pytest -q
# Windows
.venv\Scripts\python -m pytest -q
```

Expected result:

```
............                                                             [100%]
12 passed
```

| Test file | What it checks |
| --- | --- |
| `tests/test_pipeline.py` | Same payload twice doesn't bump the version · body change creates version 2 · deletes tombstone and leave the Context API · outage opens the circuit, freezes the watermark, marks stale, recovery ingests only the change · reconciliation tombstones vanished ids · duplicates link to the higher-ranked source · conflicts resolved by the authority table · hidden instructions are not retrievable · Sam can't see Alex-only controls · poison messages dead-letter after 3 attempts and can be replayed |
| `tests/test_mappers.py` | Jira, ADO, SharePoint, Quickbase, Git and the rule workbook map to the canonical record and back. |
| `tests/test_logic.py` | Heading, function and transcript chunking; PII and prompt-injection detectors. |

> If Postgres is not running, the pipeline tests are **skipped** (not failed) with the message `Postgres is not available ... Start it with make up.`

More on the test strategy in [docs/F-testing.md](docs/F-testing.md).

---

## 13. Guided Demo: Failure Scenarios

The demo company is **Northwind Mutual**, and its product is **ClaimPath**. The whole corpus traces one rule on purpose:

> **`BR-101`** — Claims at or above **$10,000** need two approvers. The dollar amount lives in the finance spreadsheet as **`RULE-17`**.

### Console sections (left rail — read-only)

| Section | Use it to |
| --- | --- |
| **Sources** | See each connector's circuit state, watermark, record counts and last error. **Sync** and **Reconcile** buttons per source. |
| **Pipeline** | See stage counts (received → raw → parsed → normalized → enriched → indexed), the lineage tape and recent sync runs. |
| **Inspector** | Browse every record: Overview, Raw payload, Chunks, Edges, Versions, Lineage. |
| **Trace** | A Policy → Work → Build → Prove map of the `BR-101` story. |
| **Quality** | Conflicts, duplicates, dead letters, quarantined and stale records. |
| **Context API** | The exact payload an agent receives. Switch between users (**Alex**, **Sam**, **Compliance**) to see permission trimming. |

Click **Present the flow** in the header (or open http://127.0.0.1:5173/#present) for an animated walkthrough mode.

### Situations (left rail — these change data)

Click them **in order**. After each click, read the notice under the header — it is the server's own summary of what happened.

| # | Button | What happens | Where to look |
| --- | --- | --- | --- |
| 1 | **Change JIRA-501** | Jira sends a webhook with just the key. The connector re-reads that one story and stores version 2. Nothing else is copied. | Inspector → `jira:JIRA-501` → Versions |
| 2 | **Delete BR-102** | The SharePoint delete becomes a tombstone. It leaves the agent index; the old text stays in Versions. | Inspector → `sharepoint:BR-102` |
| 3 | **Take ADO offline** | Two failed polls open the circuit. ADO records are marked stale. The watermark stays put. | Sources → ADO row |
| 4 | **Edit EPIC-42 during the outage** | The edit waits in the queue; the hub still shows the old title. | Inspector → `ado:EPIC-42` |
| 5 | **Restore ADO and catch up** | Catch-up runs from the frozen watermark and brings back only the epic edit. Stale marks clear. | Pipeline → Recent syncs (Unchanged vs Upserted) |
| 6 | **Drift the Quickbase copy** | Quickbase now says $5,000. The finance spreadsheet stays authoritative at $10,000. Both values remain visible. | Quality → Conflicts |
| 7 | **Quarantine a hidden instruction** | New job aid `JA-100` contains a prompt injection. It is kept in the raw zone and kept out of the Context API. | Quality → Quarantine |
| 8 | **Remove Sam from BR-101** | SharePoint revokes Sam's access. The hub re-reads permissions. | Context API → ask the same question as **Sam**, then as **Alex** |
| 9 | **Send a poison payload** | A message fails parsing three times and moves to the dead-letter queue. | Quality → Dead letters |
| 10 | **Replay the oldest dead letter** | The message is replayed without the poison flag and indexed. | Quality → Dead letters (status `replayed`) |

> The situation buttons have **no undo**. To get back to the original seed data, run `make reset` and then `make demo` again.

A detailed screen-by-screen tour is in [docs/G-console-walkthrough.md](docs/G-console-walkthrough.md).

---

## 14. API Reference

All hub endpoints are prefixed with `/api` and served on port `8000`. Full interactive docs: http://127.0.0.1:8000/docs.

### Hub API (`:8000`)

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Database, mock-source and blob-mirror status. |
| `GET` | `/api/overview` | Totals (active, stale, conflicts, duplicates, quarantine, dead letters, queued), stage counts, last run. |
| `GET` | `/api/sources` | Per-source circuit, watermark, counts and last error. |
| `POST` | `/api/sync/{source}` | Delta-poll one source since its watermark. |
| `POST` | `/api/reconcile/{source}` | Compare id lists and tombstone records the source no longer has. |
| `POST` | `/api/webhooks/{source}` | Queue a webhook (`{"event": ..., "ref": ...}`) or a full record (`{"record": {...}}`). |
| `GET` | `/api/lineage?limit=80&after_id=` | Lineage / audit events. |
| `GET` | `/api/runs` | The 12 most recent ingest runs. |
| `GET` | `/api/entities?q=` | List or search entities. |
| `GET` | `/api/entities/detail?id=` | One entity with versions, chunks, edges, raw payload and lineage. |
| `GET` | `/api/graph` | Nodes and edges for the Trace view. |
| `GET` | `/api/quality` | Conflicts, duplicates, stale, quarantine and dead letters. |
| `GET` | `/api/context?q=&user=` | **The agent contract.** Permission-trimmed chunks. `user` is `alex`, `sam` or `compliance`. |
| `POST` | `/api/dlq/{item_id}/replay` | Replay one dead-letter item. |
| `POST` | `/api/scenarios/{name}` | Run a demo situation (names below). |

Scenario names: `edit-jira`, `delete-brd`, `ado-outage`, `edit-during-outage`, `ado-recover`, `conflict`, `injection`, `revoke-acl`, `poison`, `replay-latest`.

Source names: `sharepoint`, `ado`, `jira`, `rules`, `quickbase`, `git`, `manual_tests`, `transcripts`, `jobaids`, `andisense`, `socs`, `srts`.

### Example: query the Context API

```bash
curl "http://127.0.0.1:8000/api/context?q=dual%20approval%20threshold&user=sam"
```

The response contains `query`, `user`, `contract`, `model_called` (always `false`), `results` (ranked, permission-trimmed chunks with source ids) and `note`.

### Mock sources control API (`:8001`)

Used by the scenarios to simulate real-world events.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness. |
| `GET` | `/control/health` | Record counts per source and current outages. |
| `POST` | `/control/reset` | Restore the seed corpus. |
| `POST` | `/control/outage` | `{"source": "ado", "down": true}` — take a source offline or back online. |
| `POST` | `/control/mutate` | Change a record and fire its webhook. |
| `POST` | `/control/add` | Add a new record. |

---

## 15. Data Model

Defined in [`hub/schema.sql`](hub/schema.sql). Tables are created automatically when the hub starts.

| Table | Purpose |
| --- | --- |
| `authority_rule` | Which source wins for each record type (lower rank wins). Seed data — e.g. SharePoint rank 1 for business requirements, finance spreadsheet rank 1 for config rules. |
| `entity` | One row per source record: current state, status, ACL, flags, raw path. Ids look like `jira:JIRA-501`. |
| `entity_version` | Every content version ever stored. |
| `chunk` | Retrievable pieces with a `vector(64)` embedding and a generated `tsvector` for keyword search. |
| `edge` | Links between records: `IMPLEMENTS`, `GOVERNED_BY`, `DUPLICATE_OF`, `MENTIONS`, … |
| `sync_state` | Per-source watermark, circuit state and failure count. |
| `ingest_run` | One row per sync: received, upserted, unchanged, retired, failed, quarantined. |
| `lineage_event` | Audit log of every stage for every record. |
| `conflict` | Disagreeing values between sources and which one the authority table chose. |
| `dlq_item` | Dead-lettered messages and their replay status. |
| `queue_message` | The work queue (stands in for Azure Service Bus). |

---

## 16. Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` / `failed to connect to the docker API` | Docker is not running. | Open Docker Desktop and wait until it is fully started, then retry. |
| `make: command not found` | `make` is not installed (common on Windows). | Install it (see [Prerequisites](#5-prerequisites)) or follow [Manual Setup](#7-manual-setup-windows-or-without-make). |
| `python3: command not found` (Windows) | Windows uses `python` or `py`. | Use `python` or `py -3.11` instead of `python3`. |
| `database did not become ready` | Postgres container is not healthy. | Run `docker compose ps` and `docker compose logs postgres`. Check that port 54329 is free. |
| `address already in use` / port error | Another program uses 5173, 8000, 8001, 54329 or 10000. | Stop that program, or find it with `lsof -i :8000` (macOS/Linux) or `netstat -ano \| findstr :8000` (Windows). |
| First sync or `make test` hangs for **~3 minutes** | Azurite is not running. The Azure SDK retries the blob connection several times before falling back to the filesystem. | Make sure **both** containers are up: `docker compose up -d` then `docker compose ps`. `/api/health` should show `"blob_mirror": "azurite"`. |
| Console stats stay at 0 | The hub started before the mock sources, so it skipped the initial sync. | Make sure mock sources are running on :8001, then restart the hub or click **Sync** on each row of the Sources screen. |
| Console shows network errors | The hub API is not running. | Start it (`python -m hub`) and check http://127.0.0.1:8000/api/health. |
| `/api/health` shows `"mock": false` | Mock sources are not running. | Start `python -m mock_sources` (Terminal 1). |
| Pipeline tests show as **skipped** | Postgres is not reachable. | `docker compose up -d`, then run the tests again. |
| `npm install` fails | Node.js is older than 18. | Upgrade Node.js, delete `dashboard/node_modules`, run `npm install` again. |
| `TypeError: unsupported operand type(s) for \|` on startup | Python is older than 3.11. | Install Python 3.11+, delete `.venv`, and repeat the venv step. |
| Demo data is messy after many clicks | Situations have no undo. | `make reset` (or `docker compose down -v` and delete the `data/` folder), then start again. |

---

## 17. Stopping and Resetting

| Goal | macOS / Linux | Windows |
| --- | --- | --- |
| Stop the app | `Ctrl + C` in the terminal(s) | `Ctrl + C` in each terminal |
| Stop Docker containers (keep data) | `make down` | `docker compose down` |
| Full reset to seed data | `make reset` | `docker compose down -v` then delete the `data\` folder (holds the raw zone and the mock sources' saved state) |

After a full reset, start again with `make demo` (or the [Manual Setup](#7-manual-setup-windows-or-without-make) steps).

---

## 18. Further Documentation

The full architecture and design write-up is in the [`docs/`](docs/) folder:

| Document | Contents |
| --- | --- |
| [A. Architecture](docs/A-architecture.md) | The design, what changed from the original sketch, and how a record moves. |
| [B. Technology Stack](docs/B-technology-stack.md) | Production technology choices and the alternatives considered. |
| [C. Data Flow](docs/C-data-flow.md) | Detailed data flow through each stage. |
| [D. Design Notes](docs/D-design-notes.md) | Assumptions, trade-offs, security and open questions. |
| [E. Roadmap](docs/E-roadmap.md) | Incremental delivery plan. |
| [F. Testing](docs/F-testing.md) | What is tested today and what would be added before production. |
| [G. Console Walkthrough](docs/G-console-walkthrough.md) | Screen-by-screen tour of the operator console. |
| [Background.MD](Background.MD) | The original assessment brief. |
