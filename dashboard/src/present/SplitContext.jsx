import { useEffect, useState } from "react";
import { api, when } from "../api";
import { SOURCE_COLOR } from "./geometry";

const PRESETS = [
  "Which rule sets the dual approval threshold for BR-101?",
  "What did the March meeting decide about JIRA-502?",
  "Where is dual approval implemented?",
];

const PEOPLE = ["sam", "alex"];

export function SplitContext({ tick }) {
  const [query, setQuery] = useState(PRESETS[0]);
  const [draft, setDraft] = useState(PRESETS[0]);
  const [payloads, setPayloads] = useState({});
  const [error, setError] = useState("");
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    let stop = false;
    Promise.all(
      PEOPLE.map((person) =>
        api(`/api/context?q=${encodeURIComponent(query)}&user=${person}`).then((body) => [person, body]),
      ),
    )
      .then((pairs) => {
        if (!stop) {
          setPayloads(Object.fromEntries(pairs));
          setError("");
        }
      })
      .catch((err) => {
        if (!stop) setError(err.message);
      });
    return () => {
      stop = true;
    };
  }, [query, tick]);

  const ids = Object.fromEntries(
    PEOPLE.map((person) => [person, new Set((payloads[person]?.results || []).map((row) => row.entity_id))]),
  );

  return (
    <section className="split">
      <form
        className="split-query"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft);
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Question for the Context API" />
        <button className="p-button" type="submit">
          Ask both
        </button>
      </form>
      <div className="split-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={preset === query ? "chip on" : "chip"}
            onClick={() => {
              setDraft(preset);
              setQuery(preset);
            }}
          >
            {preset}
          </button>
        ))}
      </div>
      {error ? <p className="p-error">{error}</p> : null}
      <div className="split-cols">
        {PEOPLE.map((person) => {
          const other = PEOPLE.find((name) => name !== person);
          const payload = payloads[person];
          const missing = [...(ids[other] || [])].filter((id) => !ids[person].has(id));
          return (
            <div className="split-col" key={person}>
              <header>
                <h3>Asked as {person[0].toUpperCase() + person.slice(1)}</h3>
                <span className="mono">{payload ? `${payload.results.length} chunks · model called: ${String(payload.model_called)}` : "…"}</span>
              </header>
              {missing.length ? (
                <p className="withheld">
                  Not in this payload: <span className="mono">{missing.map((id) => id.split(":")[1]).join(", ")}</span>.{" "}
                  {person} is not on the access list. The title is withheld too.
                </p>
              ) : null}
              {payload?.results.length === 0 ? <p className="drawer-empty">Nothing this person may see matched.</p> : null}
              {(payload?.results || []).map((result) => (
                <article key={result.chunk_id} className={ids[other]?.has(result.entity_id) ? "ctx-card" : "ctx-card only"}>
                  <header>
                    <span className="drawer-dot" style={{ background: SOURCE_COLOR[result.source] || "#9eb4c6" }} />
                    <b className="mono">{result.source_id}</b>
                    <span className="mono">v{result.version}</span>
                    <span className={`pill tone-${result.authoritative ? "ok" : "warn"}`}>
                      {result.authoritative ? "authority" : "not the authority"}
                    </span>
                    {result.freshness === "stale" ? <span className="pill tone-warn">stale</span> : null}
                    {(result.flags || []).map((flag) => (
                      <span key={flag} className="pill tone-warn">{flag}</span>
                    ))}
                    {!ids[other]?.has(result.entity_id) ? <span className="pill tone-alert">only {person}</span> : null}
                  </header>
                  <h4>{result.title}</h4>
                  <p className="ctx-excerpt">{result.excerpt}</p>
                  {result.conflicts?.length ? (
                    <p className="ctx-conflict">
                      Conflict on {result.conflicts[0].logical_key}: {result.conflicts[0].winner_source}{" "}
                      <b>{result.conflicts[0].winner_value}</b> vs {result.conflicts[0].loser_source}{" "}
                      <b>{result.conflicts[0].loser_value}</b>
                    </p>
                  ) : null}
                  <p className="ctx-meta mono">
                    {result.source_uri} · modified {when(result.modified_at)} · score {result.score}
                  </p>
                </article>
              ))}
            </div>
          );
        })}
      </div>
      <button type="button" className="p-button ghost" onClick={() => setShowJson((value) => !value)}>
        {showJson ? "Hide raw JSON" : "Show raw JSON for Sam"}
      </button>
      {showJson && payloads.sam ? <pre className="raw-pre">{JSON.stringify(payloads.sam, null, 2)}</pre> : null}
    </section>
  );
}
