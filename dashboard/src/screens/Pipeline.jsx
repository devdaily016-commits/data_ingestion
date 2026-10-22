import { useEffect, useState } from "react";
import { api, when } from "../api";

const STAGES = ["received", "raw", "parsed", "normalized", "enriched", "indexed"];

export function PipelineScreen({ tick, onSelect }) {
  const [events, setEvents] = useState([]);
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    api("/api/lineage?limit=40")
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
    api("/api/runs")
      .then((data) => setRuns(data.runs))
      .catch(() => setRuns([]));
  }, [tick]);

  const counts = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  events.forEach((event) => {
    if (counts[event.stage] !== undefined) counts[event.stage] += 1;
  });

  return (
    <section>
      <div className="stages" aria-label="Recent pipeline stages">
        {STAGES.map((stage) => (
          <div className={counts[stage] ? "stage has" : "stage"} key={stage}>
            <b>{counts[stage]}</b>
            <span>{stage}</span>
          </div>
        ))}
      </div>
      <div className="tape">
        {events.length === 0 ? <p className="card">Nothing has moved through the pipeline yet.</p> : null}
        {events.map((event) => (
          <article className="event" key={event.id}>
            <time className="mono">{when(event.ts)}</time>
            <div className="stage-name mono">{event.stage}</div>
            <div>
              {event.entity_id ? (
                <button className="text-button" type="button" onClick={() => onSelect(event.entity_id)}>
                  {event.entity_id}
                </button>
              ) : null}{" "}
              {event.message}
            </div>
          </article>
        ))}
      </div>
      <h2 className="panel" style={{ marginTop: "1rem" }}>Recent syncs</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Received</th>
              <th>Upserted</th>
              <th>Unchanged</th>
              <th>Retired</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="mono">{run.source}</td>
                <td>{run.mode}</td>
                <td>{run.status}</td>
                <td>{run.received}</td>
                <td>{run.upserted}</td>
                <td>{run.noop}</td>
                <td>{run.deleted}</td>
                <td>{run.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
