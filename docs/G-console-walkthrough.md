# G. Console walkthrough

This is a tour of the operator console for someone new to the repo. It explains what each screen is for, then walks the situation buttons in the left rail. Those buttons are the failure cases the pipeline is built to survive. They are not a product feature an examiner would use.

The company in the demo is Northwind Mutual. The product is ClaimPath. The whole corpus is one rule, traced on purpose:

> Claims at or above $10,000 need two approvers. That rule is `BR-101`. The dollar amount lives in the finance spreadsheet as `RULE-17`.

There is no chatbot. The Context API screen shows the JSON an agent would receive. A model is never called.

Architecture and data-flow detail live in [A. Architecture](A-architecture.md) and [C. Data flow](C-data-flow.md). This page is the click path.

## Start it

Requirements: Docker, Python 3.11 or newer, Node 18 or newer.

```bash
make demo
```

Open http://127.0.0.1:5173. The first sync takes a few seconds. Postgres is on port **54329**. The hub API is on port **8000**. The fake source systems are on port **8001**.

`make reset` deletes the database volume and the local raw zone, then you run `make demo` again. Use that when the situations have piled up and you want the corpus back to the seed. The situation buttons do not have an undo.

The page polls `/api/overview` every two seconds. After you click a situation, the notice under the header is the server's own summary of what just happened. Read that line before you go hunting.

## What you are looking at

The console is the operator view. It shows quarantined text, tombstones, and records a given person cannot see. Permissions are enforced on the Context API screen, where you pick Sam or Alex. If a record is missing from the inspector, that is a bug. If it is missing from Sam's context and present in Alex's, that is the product working.

The left rail has two groups:

- **Sections** switch the main pane. They do not change data.
- **Situations** post to `/api/scenarios/{name}` and change the fake sources, then the pipeline ingests the result. The buttons disable while one is running.

The strip under the header is hub totals. Expect these to be non-zero on a fresh demo, before you click anything:

| Stat | Fresh demo | Why it is already non-zero |
| --- | --- | --- |
| Active | Most of the corpus | Seed records that ingested cleanly. |
| Stale | 0 | Nothing is offline yet. |
| Conflicts | 1 | `JIRA-502` is a workshop draft that says $5,000. SharePoint `BR-101` says $10,000 and wins. |
| Duplicates | 2 | Quickbase `QB-9` copies `RULE-17`. AndiSense `AS-44` copies job aid `JA-12`. Copies are linked, not deleted. |
| Quarantine | 1 | Job aid `JA-99` already contains a hidden instruction. The situation button adds a second one, `JA-100`. |
| Dead letters | 0 | Empty until you send the poison payload. |
| Queued | 0 | The worker drains the queue. A number that stays up means a message is stuck. |

## The records that matter

You do not need to memorize the whole corpus. These are the ones the buttons touch, plus the ones that explain the starting conflict.

| Id | Source | What it is |
| --- | --- | --- |
| `BR-101` | SharePoint | The policy. $10,000, two approvers. Authority for that requirement. |
| `BR-102` | SharePoint | A second requirement, the 3:00 PM payment cutoff. The delete button tombstones this one. |
| `BR-103` | SharePoint | Contains an example email and SSN. Restricted to Alex and Compliance. Sam never sees it. |
| `JIRA-501` | Jira | The story that implements `BR-101`. The edit button revises this one. |
| `JIRA-502` | Jira | A draft that says $5,000. Finance did not adopt it. It is why Conflicts starts at 1. |
| `EPIC-42` | Azure DevOps | The epic for the same work. The outage buttons revolve around this. |
| `RULE-17` | Finance spreadsheet | The authoritative threshold, $10,000, cell `Rules!D2`. |
| `QB-9` | Quickbase | Operations' copy of `RULE-17`. Starts identical. The drift button changes it to $5,000. |
| `JA-12` | Job aids | How an examiner requests a second approver. |
| `JA-99` | Job aids | Already quarantined on first sync. |
| `JA-100` | Job aids | Does not exist until you click the quarantine situation. |
| `SOC-3` | Controls | Segregation of duties. Restricted to Alex and Compliance. |
| `src/approval/dual_approval.py` | Git | The function that implements the check. |

Lower authority rank wins. For a business requirement, SharePoint is rank 1 and Jira is rank 3. For a config rule, the finance spreadsheet is rank 1 and Quickbase is rank 2. The table is seed data in `hub/schema.sql`. Process Knowledge Governance would own it in production. The pipeline does not hard-code "SharePoint always wins" in the worker.

## The six screens

### Sources

One row per connector: Jira, Azure DevOps, SharePoint, Quickbase, Git, the rule workbook, transcripts, manual tests, job aids, AndiSense, controls, and the traceability sheet.

| Column | Meaning |
| --- | --- |
| Circuit | `closed` means the last polls succeeded. `Open` means the connector has failed twice in a row and stopped treating the source as healthy. |
| Watermark | The cursor. The next poll asks only for records changed after this time. It moves only after a batch settles. A source that is down does not move it. |
| In hub | How many entities from this source are stored. |
| Stale | How many of those are marked stale because the source is unreachable. The text is still there. The agent is told it may be old. |
| Last error | The most recent poll failure, or a dash. |

**Sync** polls that source for changes since the watermark. **Reconcile** asks the source for its current id list and tombstones anything the hub still has that the source no longer lists. On a fresh demo both are quiet, because startup already synced.

### Pipeline

The six stage counts (`received`, `raw`, `parsed`, `normalized`, `enriched`, `indexed`) are counts of the **latest lineage events**, not lifetime totals. A quiet stage means that stage has fallen out of the recent window, which is normal after the first sync.

The tape under the counts is the audit log. Each line is a stage, a time, and usually an entity id. Click the id to open that record in the inspector.

**Recent syncs** is the run table. The columns that matter when you are checking a situation:

- **Received** — records the connector handed the worker.
- **Upserted** — records whose content or access list actually changed.
- **Unchanged** — records seen again with the same hash and the same access list. A catch-up poll should land here for everything that did not change.
- **Retired** — tombstones.
- **Failed** — messages that did not complete. Poison ends here, then on the dead-letter queue.

### Inspector

This is the record browser. The left list is every entity. The search box matches ids and text (`BR-101`, `jira`, `rule`). The default selection is `sharepoint:BR-101`.

The stamps above the title are the state of that record: Quarantine, Tombstone, Stale, PII, Hidden instruction. A healthy record has none of them.

| Tab | What a junior should use it for |
| --- | --- |
| Overview | Body, source URI, principals, raw path, and any open conflict on this record. |
| Raw | The payload as it was stored, before it was interpreted. This is what replay reads. It is a file under `data/raw`. |
| Chunks | The pieces the Context API can return. A heading, a cell, a function, or a transcript cue. `indexed` means an agent can receive it. `not indexed` means it was deactivated (deleted or quarantined). |
| Edges | Links to other records: `IMPLEMENTS`, `GOVERNED_BY`, `DUPLICATE_OF`, `MENTIONS`, and so on. Explicit links are declared by the source. Mention edges are ids found in the text. |
| Versions | One row per content change. A body edit adds a row. An ACL-only change does not. A delete keeps the old rows. |
| Lineage | The stages this entity passed through, newest context for "did the webhook actually land?" |

Entity ids look like `jira:JIRA-501` and `sharepoint:BR-101`. That prefix is the source system, not a folder you have to create.

### Trace

A four-column map of the `BR-101` story: **Policy**, **Work**, **Build**, **Prove**. Click a box to open it in the inspector.

- Solid boxes are live records. Dashed boxes are tombstones.
- Teal lines are explicit links from the source. Grey lines are other relationships. Amber lines are `DUPLICATE_OF`. Red lines are conflicts.
- **Keep to the BR-101 story** is on by default and hides records that are not within two hops of the main rule. Turn it off to see `BR-102`, `BR-103`, and the cutoff code.
- **Show mention edges** draws the extra lines that come from an id appearing in prose. Leave it off until the explicit picture makes sense. With it on, the graph gets dense fast.

### Quality

Four cards, all of them clickable through to the inspector except the dead-letter rows, which have their own Replay button.

- **Conflicts** — two sources disagree on `threshold_usd` for the same logical key. The card names the winner, the loser, and both numbers. The loser is not deleted.
- **Duplicates** — a lower-ranked copy of the same body. `QB-9` copies `RULE-17`. `AS-44` copies `JA-12`.
- **Dead letters** — messages the worker gave up on. Replay is also a situation button. Doing it from this card replays that specific row.
- **Quarantine and stale** — hidden instructions, and records whose source is currently offline.

### Context API

This is the contract. Type a question, pick **sam** or **alex**, and press **Retrieve context**. Three presets are wired to the corpus:

1. "Which rule sets the dual approval threshold for BR-101?"
2. "What did the March meeting decide about JIRA-502?"
3. "Where is dual approval implemented?"

Each result is a chunk, not an answer. Read the stamps before the excerpt:

- **Authority** means this source wins for that field. **Not the authority** means the chunk is still returned, with a lower rank, so the agent can see the disagreement.
- **Stale** means the source was offline the last time we tried.
- **PII** means the text matched an email-shaped or SSN-shaped string. An authorized caller still receives it, with the flag visible. `BR-103` is the example, and only Alex can retrieve it.

A person who cannot see a record does not see its title either. "Nothing this person is allowed to see matched" is a successful trim, not an empty index.

**Show JSON** is the payload itself: citations, version, locator, freshness, conflicts, flags. `model_called` is `false`.

## The situations, in order

Run them top to bottom once. Later buttons assume earlier ones. After each click, read the notice, then check the screen named below.

### 1. Change JIRA-501

**What it simulates.** A Jira webhook. The event carries the issue key, not the new text. The connector re-reads `JIRA-501` and the hub stores a new version. Nothing else is copied.

**What changed in the source.** The story gains one acceptance line: examiners must record the second approver's employee id.

**Where to look.**

1. The notice should say the connector re-read that issue and stored a new version.
2. Pipeline: a new sync row for `jira` with upserted `1`. Other sources should not show a matching run from this click.
3. Inspector, search `JIRA-501`, **Versions**: a new version whose change type is an update. The previous version is still listed. **Overview** shows the new sentence. **Raw** is a new file. The old raw file is still on disk under `data/raw/jira/JIRA-501/`.

**A bug would look like** the version number staying put, or every Jira issue getting a new version.

### 2. Delete BR-102

**What it simulates.** SharePoint deletes the cutoff requirement. The hub writes a tombstone. The old text stays for audit. The chunk drops out of the agent index.

**Where to look.**

1. Inspector, `BR-102`: a Tombstone stamp. **Chunks** say `not indexed`. **Versions** still lists the earlier versions, plus the delete.
2. Trace: turn off "Keep to the BR-101 story". `BR-102` is a dashed box.
3. Context API, ask about the same-day cutoff as either person. `BR-102` should not come back. `RULE-18` and `src/payments/cutoff.py` may still match, because those records were not deleted.

**A bug would look like** the row disappearing from the inspector, or the chunk still marked `indexed`.

### 3. Take ADO offline

**What it simulates.** Azure DevOps starts returning 503. The connector polls twice. Two failures open the circuit. ADO rows are marked stale. The watermark stays where it was.

**Where to look.**

1. Sources, the `ado` row: an Offline stamp, circuit **Open**, stale count above zero, last error filled in. Note the watermark time and do not expect it to change on the next poll.
2. Quality, **Quarantine and stale**: `EPIC-42` and `FEAT-88` listed as stale.
3. Context API, the dual-approval question: ADO chunks can still appear, with a **Stale** stamp. The text is the last good copy. The agent is told it might be old.

**A bug would look like** the watermark jumping forward while the source is down, or the ADO rows vanishing.

### 4. Edit EPIC-42 during the outage

Do this while ADO is still offline. The button edits the epic in the fake source and enqueues a webhook. The connector cannot re-read ADO, so the hub keeps the previous title.

**Where to look.**

1. The notice should say the webhook is waiting and the hub still shows the previous title.
2. Inspector, `EPIC-42`: title is still "Dual approval for high-value claims". No new version.
3. Pipeline: you may see a received or abandoned line. You should not see a new indexed version of `EPIC-42`.

**A bug would look like** the revised title ("limit note revised") appearing in the inspector before recovery.

### 5. Restore ADO and catch up

**What it simulates.** ADO comes back. The connector polls from the frozen watermark. Only `EPIC-42` changed, so only that epic is upserted. `FEAT-88` is unchanged and is not copied again. Stale marks clear. The circuit closes.

**Where to look.**

1. Sources, `ado`: circuit closed, Offline stamp gone, stale count `0`. The watermark is later than the one you wrote down in step 3.
2. Pipeline, the new `ado` sync: received `1` (or the epic plus the webhook catch-up, still only the epic's content). Unchanged should account for `FEAT-88`, not a second copy of its body.
3. Inspector, `EPIC-42`: title now ends with "limit note revised". **Versions** gained one row. `FEAT-88` version did not bump.

**A bug would look like** both ADO work items getting a new version, or the epic title staying on the old text.

### 6. Drift the Quickbase copy

**What it simulates.** Operations edits `QB-9` so the threshold reads $5,000. The finance spreadsheet `RULE-17` still says $10,000. Rank says the spreadsheet wins. Both numbers stay on the conflict. The Quickbase row is not overwritten and not deleted.

**Where to look.**

1. Quality, **Conflicts**: a row for logical key `RULE-17`. Winner is `rules` at `10000`. Loser is `quickbase` at `5000`. The older `BR-101` conflict (SharePoint `10000` beats Jira `5000` on `JIRA-502`) is still there too. You now have two conflicts, about two different keys.
2. Inspector, `QB-9`: the body says `5000 USD`. Overview names the conflict. `RULE-17` still says `10000` and its version did not change because of this click.
3. Context API, the threshold question: both chunks can appear. The spreadsheet is **Authority**. Quickbase is **Not the authority**, and the conflict line names both values.
4. Trace: a red line between the Quickbase copy and the spreadsheet rule.

**A bug would look like** the spreadsheet changing to $5,000, or the Quickbase number disappearing from the context payload.

### 7. Quarantine a hidden instruction

**What it simulates.** Someone pastes a job aid, `JA-100`, that says "ignore all previous instructions" and asks for a bulk export of claimant records. The bytes are written to the raw zone. The chunk is not retrievable. `JA-99` was already in this state from the seed. This button adds a second example you can watch land.

**Where to look.**

1. The quarantine stat goes up by one.
2. Quality lists `JA-100` with an injection flag.
3. Inspector, `JA-100`: stamps **Quarantine** and **Hidden instruction**. **Raw** has the original text. **Chunks** say `not indexed`.
4. Context API, as Sam or Alex: `JA-100` is absent. The console is allowed to show the text. The API is not.

**A bug would look like** the excerpt showing up in the context payload, or the raw file missing under `data/raw/jobaids/JA-100/`.

### 8. Remove Sam from BR-101

**What it simulates.** SharePoint changes the access list on `BR-101` from everyone to Compliance and Alex. The content hash does not change, so the version does not bump. The next retrieval omits the record for Sam.

**Where to look.**

1. Inspector, `sharepoint:BR-101`, Overview: principals are `compliance` and `alex`. **Versions** did not gain a row for this click. Lineage shows an ingest that updated access.
2. Context API. Ask the first preset as **sam**. `BR-101` is gone, including its title. Switch to **alex** and ask again. `BR-101` is back, stamped **Authority**.
3. Sam can still match other public records about the same rule, such as `JIRA-501` or `RULE-17`. Losing `BR-101` is not the same as an empty result. Alex also still sees `SOC-3` and `BR-103`. Sam did not see those before this click either. Their access list was already restricted.

**A bug would look like** a version bump on an ACL-only change, or Sam's JSON still containing the title "Dual approval for high-value claims".

### 9. Send a poison payload

**What it simulates.** A job aid, `JA-POISON`, is queued with a flag that makes the parser throw. The worker tries three times, then dead-letters the message. The rest of the queue keeps moving. This record does not become an active entity.

**Where to look.**

1. The dead-letter stat becomes `1`.
2. Quality, **Dead letters**: `JA-POISON`, three attempts, status `open`, with a Replay button.
3. Inspector: searching `JA-POISON` should not show an active indexed record.
4. Pipeline: a failed count on the run that tried it. Other sources are unaffected.

**A bug would look like** the poison record indexed anyway, or the queue stuck so later syncs stop.

### 10. Replay the oldest dead letter

**What it simulates.** An operator replays the oldest open dead letter. The replay clears the poison flag and ingests the record. The dead-letter row becomes `replayed`.

Run this after step 9. If the queue is empty the notice says so, and nothing else happens.

**Where to look.**

1. Quality: `JA-POISON` is no longer `open`. The dead-letter stat returns to `0`.
2. Inspector, `JA-POISON`: an active job aid whose body explains that parsing failed on purpose. **Chunks** say `indexed`.
3. Context API can now return it, because the text has no hidden instruction and the access list includes Sam and Alex.

**A bug would look like** a second dead letter, or the replay ingesting it while still flagged to fail.

## A single pass

1. Run `make demo` and wait until the stats strip is populated. Conflicts is 1. Quarantine is 1. Dead letters is 0.
2. Open **Trace** with mention edges off. Follow `BR-101` across Policy, Work, Build, and Prove. Click through to the inspector once so you know where Versions and Raw are.
3. On **Context API**, run the first preset as Sam, then as Alex. Alex's payload includes `SOC-3`. Sam's does not. That is the baseline for step 8.
4. Click the ten situations from top to bottom. After each one, check only the screen named in that section. The notice at the top is the expected outcome in one sentence.
5. When you want a clean corpus, `make reset` and `make demo` again.

## Where the UI code lives

| File | What it draws |
| --- | --- |
| `dashboard/src/App.jsx` | Rail, situation list, stats strip, which screen is mounted. |
| `dashboard/src/api.jsx` | `fetch` wrapper. Errors surface as the notice text. |
| `dashboard/src/screens/Sources.jsx` | Source table, Sync, Reconcile. |
| `dashboard/src/screens/Pipeline.jsx` | Stage counts, lineage tape, sync runs. |
| `dashboard/src/screens/Inspector.jsx` | Record list and the six tabs. |
| `dashboard/src/screens/Graph.jsx` | The trace layout. |
| `dashboard/src/screens/Quality.jsx` | Conflicts, duplicates, dead letters, quarantine. |
| `dashboard/src/screens/Context.jsx` | The agent contract, Sam and Alex. |

The situation behavior is not in the React code. `dashboard/src/App.jsx` only posts the name. The server in `hub/app.py` (`_scenario`) mutates the fake source or the queue, then waits until the worker is idle. The fake corpus starts in `mock_sources/seed.py`. If a button's notice and the screen disagree, check the scenario handler first, then the worker in `pipeline/ingest.py`.
