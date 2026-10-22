import { useEffect, useState } from "react";
import { api, Stamp, when } from "../api";

export function SourcesScreen({ tick }) {
  const [sources, setSources] = useState([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    api("/api/sources")
      .then((data) => setSources(data.sources))
      .catch((err) => setNote(err.message));
  }, [tick]);

  async function act(path) {
    setNote("");
    try {
      const result = await api(path, { method: "POST" });
      setNote(result.error ? `${result.source}: ${result.error}` : JSON.stringify(result));
    } catch (err) {
      setNote(err.message);
    }
  }

  return (
    <section>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Circuit</th>
              <th>Watermark</th>
              <th>In hub</th>
              <th>Stale</th>
              <th>Last error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.source}>
                <td>
                  <div className="mono">{source.source}</div>
                  {source.outage ? <Stamp tone="alert">Offline</Stamp> : null}
                </td>
                <td>
                  {source.circuit === "open" ? (
                    <Stamp tone="warn">Open</Stamp>
                  ) : (
                    <Stamp tone="ok">{source.status}</Stamp>
                  )}
                </td>
                <td className="mono">{when(source.watermark)}</td>
                <td className="mono">{source.entity_count}</td>
                <td className="mono">{source.stale_count}</td>
                <td>{source.last_error || "—"}</td>
                <td>
                  <div className="button-row">
                    <button className="text-button" type="button" onClick={() => act(`/api/sync/${source.source}`)}>
                      Sync
                    </button>
                    <button className="text-button" type="button" onClick={() => act(`/api/reconcile/${source.source}`)}>
                      Reconcile
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note ? <p className="notice">{note}</p> : null}
    </section>
  );
}
