import { useEffect, useState } from "react";
import { api } from "./api";
import { PresentScreen } from "./present/PresentScreen";
import { ContextScreen } from "./screens/Context";
import { GraphScreen } from "./screens/Graph";
import { InspectorScreen } from "./screens/Inspector";
import { PipelineScreen } from "./screens/Pipeline";
import { QualityScreen } from "./screens/Quality";
import { SourcesScreen } from "./screens/Sources";

const VIEWS = [
  ["sources", "Sources"],
  ["pipeline", "Pipeline"],
  ["inspector", "Inspector"],
  ["graph", "Trace"],
  ["quality", "Quality"],
  ["context", "Context API"],
];

const SITUATIONS = [
  ["Change JIRA-501", "edit-jira"],
  ["Delete BR-102", "delete-brd"],
  ["Take ADO offline", "ado-outage"],
  ["Edit EPIC-42 during the outage", "edit-during-outage"],
  ["Restore ADO and catch up", "ado-recover"],
  ["Drift the Quickbase copy", "conflict"],
  ["Quarantine a hidden instruction", "injection"],
  ["Remove Sam from BR-101", "revoke-acl"],
  ["Send a poison payload", "poison"],
  ["Replay the oldest dead letter", "replay-latest"],
];

export function App() {
  const [view, setView] = useState("sources");
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("sharepoint:BR-101");
  const [tick, setTick] = useState(0);
  const [presenting, setPresenting] = useState(() => window.location.hash === "#present");

  useEffect(() => {
    const next = presenting ? "#present" : "";
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
    }
  }, [presenting]);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      api("/api/overview")
        .then((data) => {
          if (!stop) {
            setOverview(data);
            setError("");
          }
        })
        .catch((err) => {
          if (!stop) setError(err.message || "The hub is not answering.");
        });
    };
    pull();
    const timer = setInterval(() => {
      pull();
      setTick((value) => value + 1);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  async function runSituation(name) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api(`/api/scenarios/${name}`, { method: "POST" });
      setNotice(result.message);
      setTick((value) => value + 1);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openInspector(id) {
    setSelectedId(id);
    setView("inspector");
  }

  if (presenting) {
    return <PresentScreen onExit={() => setPresenting(false)} />;
  }

  return (
    <div className="app">
      <aside className="rail">
        <div>
          <p className="brand-kicker">ClaimPath</p>
          <p className="brand">Context Hub</p>
        </div>
        <button type="button" className="present-launch" onClick={() => setPresenting(true)}>
          Present the flow
        </button>
        <nav className="nav" aria-label="Sections">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="situation">
          <h2>Situations</h2>
          {SITUATIONS.map(([label, name]) => (
            <button key={name} type="button" disabled={busy} onClick={() => runSituation(name)}>
              {label}
            </button>
          ))}
        </div>
      </aside>
      <main className="main">
        <header className="screen-head">
          <p className="thesis">The agent reads what landed here. It does not decide what is true.</p>
          <p className="lede">
            Operator view of the ingestion service. Permissions are enforced on the Context API, not on this console.
          </p>
          {error ? <p className="error-banner" role="alert">{error}</p> : null}
          {notice ? <p className="notice" role="status">{notice}</p> : null}
        </header>
        {overview ? <Stats overview={overview} /> : null}
        {view === "sources" ? <SourcesScreen tick={tick} /> : null}
        {view === "pipeline" ? <PipelineScreen tick={tick} onSelect={openInspector} /> : null}
        {view === "inspector" ? (
          <InspectorScreen tick={tick} selectedId={selectedId} onSelect={setSelectedId} />
        ) : null}
        {view === "graph" ? <GraphScreen tick={tick} onSelect={openInspector} /> : null}
        {view === "quality" ? <QualityScreen tick={tick} onSelect={openInspector} /> : null}
        {view === "context" ? <ContextScreen tick={tick} /> : null}
      </main>
    </div>
  );
}

function Stats({ overview }) {
  const items = [
    [overview.active_count, "Active"],
    [overview.stale_count, "Stale"],
    [overview.conflict_count, "Conflicts"],
    [overview.duplicate_count, "Duplicates"],
    [overview.quarantine_count, "Quarantine"],
    [overview.dlq_count, "Dead letters"],
    [overview.queue_pending, "Queued"],
  ];
  return (
    <div className="stats" aria-label="Hub totals">
      {items.map(([value, label]) => (
        <div className="stat" key={label}>
          <b>{value ?? 0}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
