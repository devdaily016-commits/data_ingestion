# F. Testing and validation

## What the automated tests cover

`pytest` runs without the source sandbox. Integration tests need the Postgres container from `docker compose`.

| Behavior | Test |
| --- | --- |
| Same payload twice does not bump the version | `tests/test_pipeline.py` |
| A body change writes version 2 and keeps version 1 | same |
| A delete deactivates chunks, keeps history, and drops out of the Context API | same |
| Two failed polls open the circuit, freeze the watermark, and mark rows stale; recovery ingests only the change | same |
| A source id that disappeared is tombstoned by reconciliation | same |
| Identical bodies become `DUPLICATE_OF` toward the higher-ranked source | same |
| Disagreeing thresholds open a conflict the authority table decides | same |
| A hidden instruction is stored and is not retrievable | same |
| Sam does not receive a control restricted to Alex | same |
| A poison message dead-letters after three attempts and can be replayed | same |
| Jira, ADO, SharePoint, Quickbase, Git, and the workbook survive a map to the canonical record and back | `tests/test_mappers.py` |
| Heading, function, and transcript chunking; PII and injection detectors | `tests/test_logic.py` |

Run them with `make test`.

## What I would add before production

- **Ingestion reliability.** A contract test against a recorded Jira webhook and a Graph delta page, including a delete and a 429. Chaos test: kill the worker mid-batch and assert the watermark did not move and the locked message returns.
- **Retrieval quality.** A labeled set of questions from examiners and engineers, scored for recall of the expected source id in the top five chunks. Keyword-only and hybrid are both scored. `BR-101` must hit on the identifier even when the wording changes. This demo's hash embedding is not that evaluation.
- **Answer quality.** Only after a model is attached. Faithfulness to the cited chunk, refusal when the top score is weak, and an explicit "sources disagree" when a conflict is present. The hub's job in that test is to have supplied the conflict, not to have written the sentence.
- **Access control.** A matrix of principal, source group, and expected ids. The test fails if a trimmed response contains a forbidden id. Include a case where the ACL shrinks after the document was already indexed.
- **Performance.** Delta of a few thousand work items completes inside the poll interval. Context API p95 under the budget the agent team sets, with the security filter in the same query rather than in application memory. The raw zone write is measured separately so a slow parser does not look like a slow source.

## How I would watch it

Each ingest run has an id. Dashboards show lag behind the watermark, dead-letter depth, quarantine count, and stale sources. An open circuit pages the connector owner. A jump in quarantine pages the person who owns job aids, because that is where free text enters.
