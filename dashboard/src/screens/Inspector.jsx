import { useEffect, useState } from "react";
import { api, Stamp, when } from "../api";

const TABS = ["Overview", "Raw", "Chunks", "Edges", "Versions", "Lineage"];

export function InspectorScreen({ tick, selectedId, onSelect }) {
  const [entities, setEntities] = useState([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState("");

  useEffect(() => {
    const path = query ? `/api/entities?q=${encodeURIComponent(query)}` : "/api/entities";
    api(path)
      .then((data) => setEntities(data.entities))
      .catch((err) => setError(err.message));
  }, [tick, query]);

  useEffect(() => {
    if (!selectedId) return;
    api(`/api/entities/detail?id=${encodeURIComponent(selectedId)}`)
      .then((data) => {
        setDetail(data);
        setError("");
      })
      .catch((err) => setError(err.message));
  }, [tick, selectedId]);

  const entity = detail?.entity;

  return (
    <section className="grid-2">
      <div className="card">
        <label>
          Find a record
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="BR-101, jira, rule" />
        </label>
        <div className="entity-list">
          {entities.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <div className="mono">{item.source_id}</div>
              <div className="meta">{item.source} · {item.type}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        {error ? <p className="error-banner">{error}</p> : null}
        {!entity ? <p>Select a record.</p> : null}
        {entity ? (
          <>
            <Stamps entity={entity} />
            <h2 style={{ margin: "0.4rem 0" }}>{entity.title || entity.source_id}</h2>
            <p className="meta mono">{entity.id} · version {entity.version} · rank {entity.authority_rank}</p>
            <div className="tabs" role="tablist">
              {TABS.map((name) => (
                <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                  {name}
                </button>
              ))}
            </div>
            {tab === "Overview" ? <Overview entity={entity} conflicts={detail.conflicts} /> : null}
            {tab === "Raw" ? <pre>{JSON.stringify(detail.raw, null, 2)}</pre> : null}
            {tab === "Chunks" ? (
              detail.chunks.map((chunk) => (
                <article className="result" key={chunk.id}>
                  <div className="meta mono">
                    {chunk.id} · {chunk.active ? "indexed" : "not indexed"} · {JSON.stringify(chunk.locator)}
                  </div>
                  <pre>{chunk.text}</pre>
                </article>
              ))
            ) : null}
            {tab === "Edges" ? (
              <ul>
                {detail.edges.map((edge) => (
                  <li key={`${edge.from_id}-${edge.to_id}-${edge.type}`}>
                    <span className="mono">{edge.type}</span> {edge.from_id} → {edge.to_id}
                    <div className="meta">{edge.method} · {edge.confidence} · {edge.evidence}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === "Versions" ? (
              <ul>
                {detail.versions.map((version) => (
                  <li key={version.version}>
                    v{version.version} {version.change_type} · {when(version.ingested_at)}
                    <div className="meta mono">{version.content_hash}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === "Lineage" ? (
              <ul>
                {detail.lineage.map((event, index) => (
                  <li key={`${event.ts}-${index}`}>
                    <span className="mono">{event.stage}</span> {event.message}
                    <div className="meta">{when(event.ts)}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function Stamps({ entity }) {
  return (
    <div>
      {entity.status === "quarantined" ? <Stamp>Quarantine</Stamp> : null}
      {entity.status === "tombstoned" || entity.deleted ? <Stamp>Tombstone</Stamp> : null}
      {entity.stale_since ? <Stamp tone="warn">Stale</Stamp> : null}
      {(entity.flags || []).includes("pii") ? <Stamp tone="warn">PII</Stamp> : null}
      {(entity.flags || []).includes("injection") ? <Stamp>Hidden instruction</Stamp> : null}
    </div>
  );
}

function Overview({ entity, conflicts }) {
  return (
    <div>
      <p className="meta">
        Modified {when(entity.modified_at)} · ingested {when(entity.ingested_at)} · source version {entity.source_version}
      </p>
      <p className="meta mono">{entity.source_uri}</p>
      <p className="meta">Principals: {(entity.acl_principals || []).join(", ") || "none"}</p>
      <p className="meta mono">Raw: {entity.raw_blob_path}</p>
      {conflicts?.length ? (
        <p>
          <Stamp tone="warn">Conflict</Stamp>
          {conflicts.map((item) => (
            <span key={item.id}>
              {" "}
              {item.field}: {item.winner_source} {item.winner_value} beats {item.loser_source} {item.loser_value}.
            </span>
          ))}
        </p>
      ) : null}
      <pre>{entity.body}</pre>
    </div>
  );
}
