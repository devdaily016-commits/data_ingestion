import { useEffect, useState } from "react";
import { api, Stamp, when } from "../api";

const PRESETS = [
  "Which rule sets the dual approval threshold for BR-101?",
  "What did the March meeting decide about JIRA-502?",
  "Where is dual approval implemented?",
];

export function ContextScreen({ tick }) {
  const [query, setQuery] = useState(PRESETS[0]);
  const [user, setUser] = useState("sam");
  const [payload, setPayload] = useState(null);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!payload) return;
    ask(query, user);
    // Refresh after a situation changes ACLs or freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function ask(nextQuery = query, nextUser = user) {
    setError("");
    try {
      const data = await api(`/api/context?q=${encodeURIComponent(nextQuery)}&user=${encodeURIComponent(nextUser)}`);
      setPayload(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card">
      <p className="lede">
        This is the JSON an agent would receive. No model is called. A person who cannot see a record does not see its title either.
      </p>
      <div className="person-toggle" role="group" aria-label="Person">
        {["sam", "alex"].map((person) => (
          <button
            key={person}
            className={user === person ? "solid-button" : "text-button"}
            type="button"
            onClick={() => {
              setUser(person);
              ask(query, person);
            }}
          >
            {person}
          </button>
        ))}
      </div>
      <form
        className="query-row"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Question" />
        <button className="solid-button" type="submit">Retrieve context</button>
      </form>
      <div className="button-row">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            className="text-button"
            type="button"
            onClick={() => {
              setQuery(preset);
              ask(preset, user);
            }}
          >
            {preset}
          </button>
        ))}
      </div>
      {error ? <p className="error-banner">{error}</p> : null}
      {payload ? (
        <>
          <p className="meta">{payload.note} Contract {payload.contract}. Model called: {String(payload.model_called)}.</p>
          {payload.results.length === 0 ? <p>Nothing this person is allowed to see matched.</p> : null}
          {payload.results.map((result) => (
            <article className="result" key={result.chunk_id}>
              <div>
                {!result.authoritative ? <Stamp tone="warn">Not the authority</Stamp> : <Stamp tone="ok">Authority</Stamp>}
                {result.freshness === "stale" ? <Stamp tone="warn">Stale</Stamp> : null}
                {(result.flags || []).includes("pii") ? <Stamp tone="warn">PII</Stamp> : null}
              </div>
              <h3 style={{ margin: "0.3rem 0" }}>{result.title}</h3>
              <p className="meta mono">
                {result.source}:{result.source_id} · v{result.version} · {result.source_uri} · score {result.score}
              </p>
              <p className="meta">Modified {when(result.modified_at)} · locator {JSON.stringify(result.locator)}</p>
              {result.conflicts?.length ? (
                <p className="meta">
                  Conflict on {result.conflicts[0].logical_key}: {result.conflicts[0].winner_source} {result.conflicts[0].winner_value} vs {result.conflicts[0].loser_source} {result.conflicts[0].loser_value}.
                </p>
              ) : null}
              <pre>{result.excerpt}</pre>
            </article>
          ))}
          <button className="text-button" type="button" onClick={() => setShowJson((value) => !value)}>
            {showJson ? "Hide JSON" : "Show JSON"}
          </button>
          {showJson ? <pre>{JSON.stringify(payload, null, 2)}</pre> : null}
        </>
      ) : (
        <p className="meta">Retrieve context to see the contract.</p>
      )}
    </section>
  );
}
