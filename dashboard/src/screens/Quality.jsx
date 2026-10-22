import { useEffect, useState } from "react";
import { api, Stamp, when } from "../api";

export function QualityScreen({ tick, onSelect }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    api("/api/quality")
      .then(setData)
      .catch((err) => setNote(err.message));
  }, [tick]);

  async function replay(id) {
    try {
      const result = await api(`/api/dlq/${id}/replay`, { method: "POST" });
      setNote(result.message);
    } catch (err) {
      setNote(err.message);
    }
  }

  if (!data) return <p className="card">{note || "Loading data quality."}</p>;

  return (
    <section>
      {note ? <p className="notice">{note}</p> : null}
      <div className="grid-quality">
        <article className="card">
          <h2>Conflicts</h2>
          {data.conflicts.length === 0 ? <p>No open conflicts.</p> : null}
          {data.conflicts.map((item) => (
            <p key={item.id}>
              <Stamp tone="warn">Conflict</Stamp>
              <button className="text-button" type="button" onClick={() => onSelect(item.winner_id)}>
                {item.winner_source}
              </button>{" "}
              says {item.winner_value}. {item.loser_source} says {item.loser_value} for {item.logical_key}.
            </p>
          ))}
        </article>
        <article className="card">
          <h2>Duplicates</h2>
          {data.duplicates.length === 0 ? <p>No duplicate bodies.</p> : null}
          {data.duplicates.map((item) => (
            <p key={`${item.from_id}-${item.to_id}`}>
              <button className="text-button" type="button" onClick={() => onSelect(item.from_id)}>
                {item.from_source_id}
              </button>{" "}
              copies{" "}
              <button className="text-button" type="button" onClick={() => onSelect(item.to_id)}>
                {item.to_source_id}
              </button>
              <span className="meta"> {item.method} · {item.evidence}</span>
            </p>
          ))}
        </article>
        <article className="card">
          <h2>Dead letters</h2>
          {data.dlq.length === 0 ? <p>The dead-letter queue is empty.</p> : null}
          {data.dlq.map((item) => (
            <p key={item.id}>
              <span className="mono">{item.source_id || item.source}</span> · {item.error} · {item.attempts} attempts · {item.status}
              {item.status === "open" ? (
                <button className="text-button" type="button" onClick={() => replay(item.id)}>
                  Replay
                </button>
              ) : null}
            </p>
          ))}
        </article>
        <article className="card">
          <h2>Quarantine and stale</h2>
          {data.quarantine.map((item) => (
            <p key={item.id}>
              <Stamp>Quarantine</Stamp>
              <button className="text-button" type="button" onClick={() => onSelect(item.id)}>
                {item.source_id}
              </button>{" "}
              {(item.flags || []).join(", ")}
            </p>
          ))}
          {data.stale.map((item) => (
            <p key={item.id}>
              <Stamp tone="warn">Stale</Stamp>
              <button className="text-button" type="button" onClick={() => onSelect(item.id)}>
                {item.source_id}
              </button>{" "}
              since {when(item.stale_since)}
            </p>
          ))}
          {data.quarantine.length === 0 && data.stale.length === 0 ? <p>Nothing is quarantined or stale.</p> : null}
        </article>
      </div>
    </section>
  );
}
