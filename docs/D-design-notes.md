# D. Design notes

## Assumptions

These names are not defined in the brief. I used the following meanings and would confirm them before building connectors.

| Name | Working assumption | Question for the owner |
| --- | --- | --- |
| AndiSense | The current knowledge application. Box 5.8 is the product. Box 5.23 is a corpus that must be ingested so the new hub is not empty on day one. | Which teams may write to AndiSense, and does it have an API or only a database? |
| Journey | An AndiSense experience that walks a person through a process. It should call the Context API. It should not store its own copy of requirements. | Is Journey a workflow engine or a set of pages? |
| Mitigation / compliance tracking | An AndiSense experience over controls and evidence. Same rule: read the hub, do not re-implement traceability. | Which regulation or audit does it serve? |
| Process Knowledge Governance | The group that owns the authority table, the entity types, and approval when a source of truth changes. Not on the read path. | Who can edit a rank, and is that change itself audited? |
| SAMRAI | Treated as an internal model-risk function. It reviews evaluation sets and model changes. It does not own documents. The name is not expanded anywhere in the source material. | What does the acronym stand for, and does it already mandate a model registry? |
| SRTS | System requirements traceability record: a row that points a requirement at code and tests. | Is this a spreadsheet, an ADO query, or a product? |
| SOC | An internal control statement (the demo uses segregation of duties), not a SOC 2 report PDF. | Are "SOCs" control objectives, or completed audit reports? |
| Job aid | A short procedure for an examiner. | Who publishes them, and can they contain free-typed text from the field? |
| Quickbase | Operational copy of a rule. Useful, and not the authority for the threshold. | Field ids, app tokens, and the real rate limit. The demo field map is invented and listed in `connectors/mappers.py`. |
| Rule spreadsheets | Finance owns the threshold. One row is one entity. | Who is allowed to edit the workbook, and is there an approval tab? |

The fictional company in the demo is Northwind Mutual. The product is ClaimPath. `BR-101` is "claims at or above $10,000 need two approvers." `JIRA-502` is a draft that says $5,000. That conflict is deliberate.

## Trade-offs

- **Postgres first, graph database later.** The traces we need are a few hops from a requirement to a story, a file, a test, and a rule. Recursive SQL does that. A graph engine adds an operational system before we know the query shape. The edge table is the migration path: it can be exported to Gremlin or Neo4j without changing connectors.
- **Hybrid search in the database for the demo, Azure AI Search in production.** The API contract is the same. IDs such as `BR-101` are a keyword problem. Vectors help the prose. I would not ship vectors alone.
- **Local queue instead of the Service Bus emulator.** The emulator needs Azure SQL Edge, which is a poor citizen on Apple Silicon. `pipeline/queue.py` implements send, peek-lock, complete, abandon, and dead-letter. Production uses Service Bus. Do not point the laptop queue at a real namespace.
- **Hash embeddings instead of Azure OpenAI.** Retrieval ranking in the demo is good enough to show citations. It is not a quality claim about a model. Swap `pipeline/logic.py:embed` and re-embed.
- **Regex and `ast` instead of Document Intelligence and tree-sitter.** The chunk locators (heading, cell, line range, cue timestamp) are the part the rest of the system depends on. The parser behind them can change without a schema change.
- **Quarantine rather than delete** when a document contains "ignore previous instructions." The raw blob stays for an auditor. The chunk is not retrievable. A regex will miss paraphrases; Prompt Shields is the production control, and it should fail closed into the same quarantine state.
- **The operator console is not the agent.** The console shows quarantined text so a person can see why a document was stopped. The Context API does not. Shipping the console to every employee would undo that.

## Security controls

- Entra ID for users. Managed identity for connectors. Key Vault for the Quickbase user token and the webhook signing secrets.
- Webhooks are verified, then answered with 202. The body is an id. The connector refetches. A forged webhook can only cause a refetch of something the connector is already allowed to read.
- ACLs are copied from the source at ingest and filtered in the Context API query. There is no post-filter that could leak a title.
- When a source removes a person, the next delta updates `acl_principals`. The content hash does not change, so the version does not bump, and the next retrieval omits the record.
- A source delete becomes a tombstone. The index entry is deactivated. The version row remains until the retention rule says otherwise. A "right to delete" request has to include the raw zone, not only the index.
- Secrets in source text (connection strings in a wiki) are treated like PII: flagged, and a production policy can keep them out of the model context even for an authorized reader. The demo flags SSN-shaped and email-shaped strings and still returns them to an authorized caller, with the flag visible.
- Prompt injection is an ingest problem, not only a prompt-template problem. Untrusted text never becomes a system message. The retrieval contract returns it as a citation or not at all.
- Lineage records the stage, the entity, and the run. It does not need to store the full prompt of a future agent; that is a separate audit stream when generation exists.
- The largest risks are an over-broad connector credential, a missed delete, and a restricted control document indexed as "everyone." Mitigations are least-privilege app registrations per source, nightly id reconciliation, and a test that fails if a trimmed query returns a forbidden id.

## Unresolved questions

1. Which system is the authority for a business requirement today, in practice, not on the slide?
2. Do Jira issue security levels and SharePoint groups map to the same Entra groups?
3. How long must raw payloads and tombstones be kept?
4. Is claim-level personal data in scope for the first index, or only process documents?
5. What does SAMRAI already require before a model can read this index?
6. Are Journey and compliance tracking allowed to write facts back, or only to read?

## Tools

The design notes and the demo were drafted with Cursor, using the Grok 4.7 model. Azure product choices were checked against the Microsoft Learn pages linked in [B. Technology stack](B-technology-stack.md). The demo does not call those services; the stand-ins are listed in [A. Architecture](A-architecture.md). Parser behavior, conflicts, tombstones, and ACL trimming are covered by the tests in `tests/`.
