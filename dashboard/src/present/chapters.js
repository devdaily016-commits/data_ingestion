export const CHAPTERS = [
  {
    id: "map",
    kicker: "Start here",
    title: "The shape of the pipeline",
    claim:
      "Every source goes through the same path. Nothing reaches an agent until it has landed raw, been parsed, checked, and indexed with its permissions.",
    tour: ["src:sharepoint", "webhook", "poll", "queue", "check", "raw", "parse", "normalize", "quarantine", "enrich", "hub", "index", "dlq", "api", "sam"],
    watch: ["Click any box on the map to hear what it does.", "Use Next stop to walk the path in order."],
  },
  {
    id: "edit-jira",
    scenario: "edit-jira",
    kicker: "Change",
    title: "One story changes in Jira",
    claim: "A webhook names one issue. The connector re-reads just that issue, and the hub stores a new version. Nothing else is copied.",
    focus: ["src:jira", "webhook", "queue", "check", "raw", "parse", "normalize", "enrich", "hub", "index"],
    entity: "jira:JIRA-501",
    watch: ["Only JIRA-501 moves.", "It enters through the webhook, not a full sync.", "Open the record: version history shows the new acceptance criterion."],
  },
  {
    id: "delete-brd",
    scenario: "delete-brd",
    kicker: "Delete",
    title: "A requirement is deleted in SharePoint",
    claim: "A delete becomes a tombstone. The record leaves the agent index, and the old text stays in version history for audit.",
    focus: ["src:sharepoint", "webhook", "queue", "check", "raw", "hub"],
    entity: "sharepoint:BR-102",
    watch: ["The token skips parsing and goes along the delete path to the hub.", "The raw zone still gets a copy of the delete event."],
  },
  {
    id: "ado-outage",
    scenario: "ado-outage",
    kicker: "Outage",
    title: "Azure DevOps stops answering",
    claim: "Two failed polls open the circuit. ADO records are marked stale, and the watermark does not move.",
    focus: ["src:ado", "poll", "hub"],
    watchSource: "ado",
    watch: ["The ADO source turns red.", "Hub shows stale records.", "Watermark before and after are the same."],
  },
  {
    id: "edit-during-outage",
    scenario: "edit-during-outage",
    kicker: "Outage",
    title: "Someone edits EPIC-42 while ADO is down",
    claim: "The webhook arrives, but the connector cannot re-read the item. The message waits in the queue. It is not dead-lettered.",
    focus: ["src:ado", "webhook", "queue"],
    watchSource: "ado",
    entity: "ado:EPIC-42",
    watch: ["No token reaches the hub.", "Queue shows a message waiting.", "The hub still has the old title."],
  },
  {
    id: "ado-recover",
    scenario: "ado-recover",
    kicker: "Recovery",
    title: "ADO comes back and catches up",
    claim: "Catch-up starts from the frozen watermark. Only the epic that changed is re-ingested. Stale marks clear.",
    focus: ["src:ado", "poll", "webhook", "queue", "check", "raw", "parse", "normalize", "enrich", "hub", "index", "skipped"],
    watchSource: "ado",
    entity: "ado:EPIC-42",
    watch: ["EPIC-42 flows all the way through.", "The waiting webhook drains and stops at Unchanged.", "The watermark moves forward."],
  },
  {
    id: "conflict",
    scenario: "conflict",
    kicker: "Conflict",
    title: "The Quickbase copy drifts",
    claim: "Quickbase now says $5,000 and the finance sheet says $10,000. The sheet stays the authority, and both values are kept and shown.",
    focus: ["src:quickbase", "webhook", "queue", "check", "raw", "parse", "normalize", "enrich", "hub", "index"],
    entity: "quickbase:QB-9",
    watch: ["Hub reports a conflict.", "Open the record: the conflict shows winner and loser values."],
  },
  {
    id: "injection",
    scenario: "injection",
    kicker: "Safety",
    title: "A job aid hides an instruction",
    claim: "Text that tries to steer an agent is quarantined. The raw bytes stay for audit. Agents never see it.",
    focus: ["src:jobaids", "webhook", "queue", "check", "raw", "parse", "normalize", "quarantine"],
    entity: "jobaids:JA-100",
    watch: ["The token turns off at Normalize into Quarantine.", "It never reaches Enrich or the index."],
  },
  {
    id: "revoke-acl",
    scenario: "revoke-acl",
    kicker: "Access",
    title: "Sam loses access to BR-101",
    claim: "Only the permissions changed, so no new content version is written. The hub updates the ACL, and Sam's context drops the record.",
    focus: ["src:sharepoint", "webhook", "queue", "check", "raw", "parse", "normalize", "hub", "api", "sam", "alex"],
    entity: "sharepoint:BR-101",
    watch: ["The token takes the ACL-only path to the hub.", "Jump to the last chapter to ask as Sam and as Alex."],
  },
  {
    id: "poison",
    scenario: "poison",
    kicker: "Failure",
    title: "A payload that cannot be parsed",
    claim: "The parser refuses it three times. After the third strike the message goes to the dead-letter queue instead of blocking the line.",
    focus: ["webhook", "queue", "dlq"],
    entity: "jobaids:JA-POISON",
    watch: ["The token bounces between Queue and Retry three times.", "Retry / DLQ shows one dead letter."],
  },
  {
    id: "replay-latest",
    scenario: "replay-latest",
    kicker: "Recovery",
    title: "Replay the dead letter",
    claim: "Once the fault is fixed, the oldest dead letter is replayed from its stored payload. The source is not called again.",
    focus: ["dlq", "queue", "check", "raw", "parse", "normalize", "enrich", "hub", "index"],
    entity: "jobaids:JA-POISON",
    watch: ["The token starts at Retry / DLQ, not at a source.", "It reaches the index this time."],
  },
  {
    id: "context",
    kicker: "Payoff",
    title: "What the agent actually receives",
    claim: "Same question, two people. The Context API returns chunks with citations, freshness, authority, and conflicts. Records a person cannot see are absent, title included.",
    split: true,
    focus: ["hub", "index", "api", "sam", "alex"],
    watch: ["Compare the two columns.", "No model is called. This is the payload, not an answer."],
  },
];

export const NODE_INFO = {
  source: {
    title: "Source systems",
    body: "Jira, Azure DevOps, SharePoint, Quickbase, Git, and the rest. Each has its own connector, its own cursor (the watermark), and its own permissions. A red source has an open circuit: polling has failed and its records are marked stale.",
  },
  webhook: {
    title: "Webhook",
    body: "The source says which record changed, not what it says now. The connector re-reads the record by id, so a lost or out-of-order event can never write stale content.",
  },
  poll: {
    title: "Delta poll",
    body: "The safety net. Every source is also polled for records changed after its watermark. The watermark moves only after the whole batch settles, and never while the source is down.",
  },
  queue: {
    title: "Queue",
    body: "One message per record. A worker locks a message, processes it, then completes it. If the source is down the lock is released and the message waits. Stand-in for Azure Service Bus.",
  },
  check: {
    title: "Has anything changed?",
    body: "The worker hashes the content and compares the access list with what is stored. If both match it stops here. This is why a catch-up poll does not rewrite the corpus.",
  },
  skipped: {
    title: "Unchanged",
    body: "Records that match the stored hash and ACL end here. No new version, no new raw copy, no re-embedding.",
  },
  raw: {
    title: "Raw zone",
    body: "The payload is written before it is interpreted, as an immutable file. Any failure can be replayed from here without calling the source again. Stand-in for ADLS Gen2.",
  },
  parse: {
    title: "Parse",
    body: "Turns the payload into chunks with locators: a Word section, a spreadsheet row, a Python function, or a transcript cue. Same entity shape for all of them.",
  },
  normalize: {
    title: "Normalize and scan",
    body: "Builds the canonical record and scans it. Personal data is flagged and left in place for people allowed to see it. Hidden instructions are diverted to quarantine.",
  },
  quarantine: {
    title: "Quarantine",
    body: "Records with text that tries to instruct an agent. The raw copy is kept for an auditor. They are never placed in the agent index.",
  },
  enrich: {
    title: "Enrich",
    body: "Resolves links between records (requirement to story to code to test), detects duplicates, opens conflicts when copies disagree, and embeds chunks for search.",
  },
  hub: {
    title: "Context Hub",
    body: "The canonical store: entities, every version, access lists, links, conflicts, and lineage. Deletes become tombstones so history is kept. Stand-in for Postgres with pgvector.",
  },
  index: {
    title: "Search index",
    body: "Keyword plus vector search over active chunks only. Tombstoned and quarantined records are not here. Stand-in for Azure AI Search.",
  },
  dlq: {
    title: "Retry and dead letter",
    body: "A record that fails to process is retried. After three failures it moves to the dead-letter queue so it does not block everything behind it. It can be replayed later from its stored payload.",
  },
  api: {
    title: "Context API",
    body: "What an agent calls. It returns chunks, not answers, each with source link, version, freshness, authority rank, conflicts, and flags. Results are trimmed to what the caller is allowed to see.",
  },
  sam: {
    title: "Sam",
    body: "Sam can open the public records but not the restricted ones, such as BR-103 and SOC-3. An agent acting for Sam only receives what Sam can open in the source system.",
  },
  alex: {
    title: "Alex",
    body: "Alex is on the restricted access lists too. Asking the same question as Alex and as Sam shows the access trimming.",
  },
};

export function infoFor(nodeId) {
  if (nodeId?.startsWith("src:")) return NODE_INFO.source;
  return NODE_INFO[nodeId];
}

function shortId(entityId) {
  return (entityId || "").split(":").slice(1).join(":") || entityId;
}

export function captionFor(event, kind) {
  const id = shortId(event.entity_id);
  const detail = event.detail || {};
  switch (event.stage) {
    case "received":
      if (kind === "replay") return `${id} replayed from its stored dead-letter payload.`;
      if (kind === "retry") return `Retry: ${id} goes back on the queue.`;
      return event.run_id
        ? `Delta poll picked up ${id} (sync run ${event.run_id}).`
        : `Webhook named ${id}. The connector re-read the record from ${event.source}.`;
    case "noop":
      return `${id}: hash and access list match what is stored. It stops here.`;
    case "raw":
      return `Raw copy of ${id} landed${detail.raw_blob_path ? ` at ${detail.raw_blob_path}` : ""}.`;
    case "parsed":
      return `${id}: ${event.message.replace(/^Parsed/, "parsed into")}.`;
    case "normalized": {
      const flags = detail.flags?.length ? ` Flags: ${detail.flags.join(", ")}.` : "";
      return `${event.message}.${flags}`;
    }
    case "quarantined":
      return `${id}: hidden instruction found. Kept in the raw zone, kept out of the index.`;
    case "acl":
      return `${id}: only permissions changed. Same content version, new access list.`;
    case "enriched":
      return `${id} linked and embedded (${event.message}).`;
    case "indexed":
      return `${id} indexed. Agents can retrieve it now.`;
    case "tombstoned":
      return `${id} tombstoned. History kept, removed from the index.`;
    case "failed":
      return `Parser refused ${id}.`;
    default:
      return event.message || event.stage;
  }
}

export const STAGE_LABEL = {
  received: "in",
  noop: "skip",
  raw: "raw",
  parsed: "parse",
  normalized: "norm",
  quarantined: "hold",
  acl: "acl",
  enriched: "enrich",
  indexed: "index",
  tombstoned: "tomb",
  failed: "fail",
};
