# B. Technology stack

Azure is the recommended deployment because the estate already includes Azure DevOps, SharePoint, and, typically, Entra ID. Nothing below is mandatory. The demo proves the pipeline without calling Azure AI services.

| Component | Recommendation | Purpose | Why this one | Alternative considered |
| --- | --- | --- | --- | --- |
| API and workers | Python, FastAPI, Azure Container Apps | Connectors, ingestion, Context API | One language for parsers and HTTP. Container Apps scales the pollers separately from the API. | .NET, which would match ADO and SharePoint SDKs more closely. I would switch if the team is already a .NET shop. |
| Queue | Azure Service Bus, sessions off, one queue per source plus a dead-letter queue | Webhooks, retries, poison messages | Lock tokens and dead-letter are built in. A source outage must not block the others. | Event Hubs. Better for telemetry volume, worse for "this one work item failed three times." |
| Raw zone | ADLS Gen2, container `raw` | Immutable source payloads | Replay and audit without calling Jira again. Path is `source/id/version`. | Blob only, without the hierarchical namespace. Fine until lifecycle rules need folder-level retention. |
| System of record | Azure Database for PostgreSQL Flexible Server | Entities, versions, edges, ACLs, watermarks, lineage | Relational constraints fit versions and conflicts. Recursive queries are enough for the traces we draw. pgvector keeps the embedding next to the row. | Cosmos DB (Gremlin) or Neo4j as the primary store. I would add one later if traversal depth or write rate outgrows SQL. Not for the first release. |
| Retrieval index | Azure AI Search, hybrid keyword plus vector, security trimming | The index the Context API reads | Security trimming can use the principal list we stored at ingest. Hybrid search beats vectors alone on requirement IDs such as `BR-101`. | OpenSearch. A fair choice off Azure. The demo uses Postgres full text plus pgvector so the contract can be shown offline. |
| Document parsing | Azure AI Document Intelligence, layout model | Word and PDF business requirements | Heading structure becomes the chunk locator. | Unstructured.io or Apache Tika if documents must not leave the network. |
| Spreadsheets | openpyxl, one entity per rule row | Configuration rules | The cell is the citation. A whole workbook is a poor chunk. | A CSV export. Loses sheet and cell. |
| Code | tree-sitter per language, one chunk per symbol | Repositories | Keeps path, symbol, and commit. The demo uses Python's `ast` module because the sample repo is Python. | A language-server index. Heavier, and not needed to answer "where is this requirement implemented?" |
| Embeddings | Azure OpenAI `text-embedding-3-large`, truncated to the index dimension | Vectors on chunks | Same region as the data. The model id is stored on the chunk so a later model does not silently mix spaces. | A self-hosted model such as bge-m3 when claim text cannot be sent to an API. |
| Orchestration of generation | Out of scope for this layer | — | The hub stops at retrieval. An agent framework can sit on the Context API later. | LangGraph or Semantic Kernel inside the hub. I would not put that in the ingestion service. |
| Identity | Microsoft Entra ID, OIDC for people, app roles or managed identity for services | Authentication | The sources already trust Entra. | Auth0 or Cognito only if the company is not on Entra. |
| Authorization | Source ACLs copied onto each entity, trimmed at query time | A person does not gain access by asking the hub | The hub stores principals; it does not invent a second permission model. | A single "employees" group. That fails the moment a control document is restricted. |
| Secrets | Azure Key Vault, managed identity, no long-lived keys on connectors | Source credentials | Webhook secrets and Quickbase tokens rotate. | Environment variables on the laptop demo only. |
| PII and prompt injection | Azure AI Language for PII, Azure AI Content Safety Prompt Shields | Flags and quarantine | Detection runs before a chunk is marked retrievable. | Regex, which is what the demo uses so it runs offline. Regex is a tripwire, not the control. |
| Lineage | Table `lineage_event`, optional export to Microsoft Purview | Audit of ingest, not of chat | Purview is the catalog the governance team already expects. The table is the system of record either way. | Only application logs. They expire. |
| Observability | Azure Monitor, OpenTelemetry, correlation id per ingest run | Failures and lag | A stale source should page before an agent answers from it. | Grafana plus Prometheus. Reasonable if the platform team already runs them. |
| Delivery | Bicep or Terraform, GitHub Actions or Azure Pipelines, tests in this repo | Repeatable environments | The pipeline is the product; it should be promoted like one. | ClickOps in the portal. Fine for a spike, not for ACL rules. |

References:

- [Azure Service Bus](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-messaging-overview)
- [Data Lake Storage](https://learn.microsoft.com/azure/storage/blobs/data-lake-storage-introduction)
- [Azure AI Search](https://learn.microsoft.com/azure/search/search-what-is-azure-search)
- [Document Intelligence](https://learn.microsoft.com/azure/ai-services/document-intelligence/overview)
- [Microsoft Graph delta query](https://learn.microsoft.com/graph/delta-query-overview)
- [Jira webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [Azure DevOps service hooks](https://learn.microsoft.com/azure/devops/service-hooks/overview)
- [PostgreSQL full text](https://www.postgresql.org/docs/current/textsearch.html)
- [pgvector](https://github.com/pgvector/pgvector)
- [Entra ID](https://learn.microsoft.com/entra/identity/)
