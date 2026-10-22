import { useEffect, useState } from "react";
import { api, when } from "../api";
import { SOURCE_COLOR } from "./geometry";

const TABS = [
  ["changes", "What changed"],
  ["chunks", "Chunks"],
  ["access", "Access and flags"],
  ["links", "Links and conflicts"],
  ["raw", "Raw payload"],
  ["lineage", "Lineage"],
];

export function RecordDrawer({ entityId, tick, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("changes");

  useEffect(() => {
    setTab("changes");
    setData(null);
  }, [entityId]);

  useEffect(() => {
    let stop = false;
    api(`/api/entities/detail?id=${encodeURIComponent(entityId)}`)
      .then((body) => {
        if (!stop) {
          setData(body);
          setError("");
        }
      })
      .catch((err) => {
        if (!stop) setError(err.message);
      });
    return () => {
      stop = true;
    };
  }, [entityId, tick]);

  const entity = data?.entity;
  return (
    <aside className="drawer" aria-label={`Record ${entityId}`}>
      <header className="drawer-head">
        <span className="drawer-dot" style={{ background: SOURCE_COLOR[entity?.source] || "#9eb4c6" }} />
        <div className="drawer-title">
          <p className="mono drawer-id">{entityId}</p>
          <h3>{entity?.title || (error ? "Not in the hub yet" : "Loading")}</h3>
        </div>
        {entity ? <StatusPills entity={entity} conflicts={data.conflicts} /> : null}
        <button type="button" className="p-button ghost" onClick={onClose} aria-label="Close record">
          Close
        </button>
      </header>
      {error && !data ? <p className="drawer-empty">{error}</p> : null}
      {data ? (
        <>
          <nav className="drawer-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="drawer-body">
            {tab === "changes" ? <Changes versions={data.versions} entity={entity} /> : null}
            {tab === "chunks" ? <Chunks chunks={data.chunks} /> : null}
            {tab === "access" ? <Access entity={entity} /> : null}
            {tab === "links" ? <Links edges={data.edges} conflicts={data.conflicts} entityId={entityId} /> : null}
            {tab === "raw" ? <Raw entity={entity} raw={data.raw} /> : null}
            {tab === "lineage" ? <Lineage events={data.lineage} /> : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

function StatusPills({ entity, conflicts }) {
  const pills = [[`v${entity.version}`, "quiet"]];
  if (entity.deleted) pills.push(["tombstone", "quiet"]);
  else if (entity.status === "quarantined") pills.push(["quarantined", "alert"]);
  else pills.push(["active", "ok"]);
  if (entity.stale_since) pills.push(["stale", "warn"]);
  if (conflicts?.length) pills.push(["conflict", "alert"]);
  (entity.flags || []).forEach((flag) => pills.push([flag, flag === "injection" ? "alert" : "warn"]));
  return (
    <div className="pills">
      {pills.map(([label, tone]) => (
        <span key={label} className={`pill tone-${tone}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Changes({ versions, entity }) {
  if (!versions?.length) return <p className="drawer-empty">No versions stored.</p>;
  const [latest, previous] = versions;
  return (
    <div className="changes">
      <ol className="version-rail">
        {versions.map((version) => (
          <li key={version.version} className={`change-${version.change_type}`}>
            <b className="mono">v{version.version}</b>
            <span>{version.change_type}</span>
            <time>{when(version.ingested_at)}</time>
          </li>
        ))}
      </ol>
      <div className="diff-pane">
        {latest.change_type === "delete" ? (
          <p className="diff-note">
            Deleted at the source. This tombstone keeps the last text below so an auditor can still read it.
          </p>
        ) : previous ? (
          <p className="diff-note">
            v{previous.version} to v{latest.version}. <ins>Added</ins> and <del>removed</del> words are marked.
          </p>
        ) : (
          <p className="diff-note">First version stored. Nothing to compare yet.</p>
        )}
        {previous && latest.title !== previous.title ? (
          <p className="diff-title">
            <del>{previous.title}</del> <ins>{latest.title}</ins>
          </p>
        ) : null}
        <p className="diff-text">
          {previous && latest.change_type !== "delete"
            ? diffWords(previous.body || "", latest.body || "").map((part, index) => {
                if (part.type === "add") return <ins key={index}>{part.text}</ins>;
                if (part.type === "del") return <del key={index}>{part.text}</del>;
                return <span key={index}>{part.text}</span>;
              })
            : latest.body || entity.body}
        </p>
      </div>
    </div>
  );
}

function Chunks({ chunks }) {
  if (!chunks?.length) return <p className="drawer-empty">No chunks. Deleted records drop theirs from the index.</p>;
  return (
    <div className="chunk-grid">
      {chunks.map((chunk) => (
        <article key={chunk.id} className={chunk.active ? "chunk" : "chunk inactive"}>
          <header>
            <b className="mono">#{chunk.ordinal}</b>
            <span className="mono">{JSON.stringify(chunk.locator)}</span>
            {!chunk.active ? <span className="pill tone-quiet">not served</span> : null}
          </header>
          <p>{chunk.text}</p>
        </article>
      ))}
    </div>
  );
}

function Access({ entity }) {
  const rows = [
    ["Who can retrieve it", (entity.acl_principals || []).join(", ") || "nobody"],
    ["Authority rank", entity.authority_rank ?? "default"],
    ["Flags", (entity.flags || []).join(", ") || "none"],
    ["Status", entity.deleted ? "tombstoned" : entity.status],
    ["Stale since", entity.stale_since ? when(entity.stale_since) : "fresh"],
    ["Source link", entity.source_uri || "none"],
    ["Source version", entity.source_version || "none"],
    ["Parser", entity.parser_version],
    ["Modified at source", when(entity.modified_at)],
    ["Ingested", when(entity.ingested_at)],
  ];
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="mono">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ edges, conflicts, entityId }) {
  return (
    <div className="links">
      {conflicts?.length ? (
        <div className="conflicts">
          {conflicts.map((conflict) => (
            <article key={`${conflict.winner_id}-${conflict.loser_id}`} className="conflict-card">
              <p className="mono">{conflict.logical_key} · {conflict.field}</p>
              <div className="versus">
                <div className="winner">
                  <span>Authority</span>
                  <b>{conflict.winner_value}</b>
                  <small className="mono">{conflict.winner_source}</small>
                </div>
                <em>vs</em>
                <div className="loser">
                  <span>Disagrees</span>
                  <b>{conflict.loser_value}</b>
                  <small className="mono">{conflict.loser_source}</small>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!edges?.length ? <p className="drawer-empty">No links resolved for this record.</p> : null}
      <ul className="edge-list">
        {(edges || []).map((edge) => {
          const outgoing = edge.from_id === entityId;
          return (
            <li key={`${edge.from_id}-${edge.to_id}-${edge.type}`} className={edge.active ? "" : "inactive"}>
              <span className="mono">{outgoing ? "to" : "from"}</span>
              <b className="mono">{outgoing ? edge.to_id : edge.from_id}</b>
              <span className="edge-type">{edge.type}</span>
              <small>{edge.method} · {edge.evidence}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Raw({ entity, raw }) {
  return (
    <div>
      <p className="diff-note mono">{entity.raw_blob_path || "No raw path"}</p>
      <pre className="raw-pre">{raw ? JSON.stringify(raw, null, 2) : "Raw file not found on this machine."}</pre>
    </div>
  );
}

function Lineage({ events }) {
  return (
    <ol className="lineage-list">
      {(events || []).map((event, index) => (
        <li key={index}>
          <time className="mono">{when(event.ts)}</time>
          <b className="mono">{event.stage}</b>
          <span>{event.message}</span>
        </li>
      ))}
    </ol>
  );
}

function diffWords(before, after) {
  const a = before.split(/(\s+)/).slice(0, 1200);
  const b = after.split(/(\s+)/).slice(0, 1200);
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const parts = [];
  const push = (type, text) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return parts;
}
