# E. Implementation roadmap

The first release is a data pipeline with one traced business rule, not an agent.

## Phase 0 — prototype (this demo)

- Sources: Jira, SharePoint business requirements, one Git repository.
- Also wired so the story is complete: Azure DevOps, Quickbase, the rule workbook, a transcript, a manual test, a job aid, a control, a traceability row, and the AndiSense copy.
- Canonical entity, chunk, edge, watermark, tombstone, quarantine, conflict, dead-letter.
- Context API that returns citations and does not call a model.
- Postpone: real Entra login, Purview export, tree-sitter for languages other than Python, a graph database, Journey, compliance tracking, and any chat surface.

Exit criteria: a changed Jira issue creates one new version; a SharePoint delete leaves a tombstone; an ADO outage freezes the watermark; a forbidden principal does not appear in the Context API.

## Phase 1 — first real sources

- Replace the sandbox with Jira, one SharePoint library, and one ADO project. Read-only app registrations.
- Turn on webhook signature checks and the nightly reconciliation job.
- Load the real authority table with Process Knowledge Governance. Do not keep the demo ranks.
- Add the ACL test to the pipeline that promotes the environment.
- Keep generation out. Let a person read the Context API JSON and say whether the citations are the right ones.

Exit criteria: seven days of sync with no silent gap (reconciliation id match at or above 99 percent), and zero forbidden ids in a trimmed query over a labeled sample.

## Phase 2 — the rest of the estate

- Quickbase, rule workbooks, transcripts, test-management exports, job aids, controls, SRTS, and the AndiSense corpus.
- Semantic near-duplicate as a suggestion, not an automatic merge. The demo already links exact copies; fuzzy merges need a person.
- Purview export of lineage.
- AndiSense Journey and compliance tracking call the Context API. They do not get their own copies of `BR-101`.

Exit criteria: a reviewer can start from a requirement and land on the code symbol, the test, and the rule cell, with the source version on each hop. Link precision on a labeled sample is agreed with the governance group before more sources are added.

## Explicitly later

- A dedicated graph database, if the SQL traces get slow or the questions need path finding the recursive queries cannot express.
- Cross-repository call graphs.
- Writing back to Jira or ADO. The hub is a reader until there is an owner for "the agent changed a story."
- The chatbot. It is a client of the Context API. Building it first would hide every gap this pipeline is meant to show.

## What I would not do in the prototype

I would not index every SharePoint site, and I would not embed the whole Git history. One library and one branch answer whether the model of a chunk is right. More sources are a reward for the exit criteria, not a way to look finished.
