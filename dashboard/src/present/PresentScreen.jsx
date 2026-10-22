import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, when } from "../api";
import { CHAPTERS, STAGE_LABEL, captionFor, infoFor } from "./chapters";
import { FlowMap } from "./FlowMap";
import { NODES, SOURCE_COLOR, SOURCE_LABEL } from "./geometry";
import { RecordDrawer } from "./RecordDrawer";
import { SplitContext } from "./SplitContext";
import { useLineageStream } from "./useLineageStream";
import "./present.css";

const SPEEDS = [0.5, 1, 2];
const CAPTION_LIMIT = 40;

export function PresentScreen({ onExit }) {
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [tourStep, setTourStep] = useState(-1);
  const [drawer, setDrawer] = useState(null);
  const [runs, setRuns] = useState({});
  const [sources, setSources] = useState([]);
  const [overview, setOverview] = useState(null);
  const [tick, setTick] = useState(0);
  const [hubError, setHubError] = useState("");
  const stream = useLineageStream({ speed, paused });
  const captionsRef = useRef(null);

  const chapter = CHAPTERS[index];
  const run = runs[chapter.id];

  useEffect(() => {
    let stop = false;
    let timer = null;
    const pull = async () => {
      try {
        const [sourceBody, overviewBody] = await Promise.all([api("/api/sources"), api("/api/overview")]);
        if (!stop) {
          setSources(sourceBody.sources);
          setOverview(overviewBody);
          setHubError("");
          setTick((value) => value + 1);
        }
      } catch (err) {
        if (!stop) setHubError(err.message || "The hub is not answering.");
      }
      if (!stop) timer = setTimeout(pull, 1200);
    };
    pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const goTo = useCallback(
    (next) => {
      const clamped = Math.max(0, Math.min(CHAPTERS.length - 1, next));
      setIndex(clamped);
      setSelectedNode(null);
      setTourStep(-1);
      setDrawer(null);
      stream.resetHits();
    },
    [stream.resetHits],
  );

  const runScenario = useCallback(async () => {
    if (!chapter.scenario || run?.running) return;
    const startCursor = stream.cursor ?? 0;
    const wmBefore = sources.find((row) => row.source === chapter.watchSource)?.watermark ?? null;
    stream.resetHits();
    setRuns((all) => {
      const closed = Object.fromEntries(
        Object.entries(all).map(([id, item]) => [id, item.endCursor == null ? { ...item, endCursor: startCursor } : item]),
      );
      return {
        ...closed,
        [chapter.id]: { startCursor, captionSeq: stream.seq, running: true, wmBefore, message: "", error: "" },
      };
    });
    try {
      const result = await api(`/api/scenarios/${chapter.scenario}`, { method: "POST" });
      setRuns((all) => ({ ...all, [chapter.id]: { ...all[chapter.id], running: false, message: result.message } }));
    } catch (err) {
      setRuns((all) => ({ ...all, [chapter.id]: { ...all[chapter.id], running: false, error: err.message } }));
    }
  }, [chapter, run, sources, stream.cursor, stream.seq, stream.resetHits]);

  const replay = useCallback(() => {
    if (!run) return;
    stream.resetHits();
    const seq = stream.replay(run.startCursor, run.endCursor);
    setRuns((all) => ({ ...all, [chapter.id]: { ...all[chapter.id], captionSeq: seq } }));
  }, [chapter.id, run, stream.replay, stream.resetHits]);

  const nextStop = useCallback(() => {
    if (!chapter.tour) return;
    const step = (tourStep + 1) % chapter.tour.length;
    setTourStep(step);
    setSelectedNode(chapter.tour[step]);
  }, [chapter.tour, tourStep]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (event.key === "Escape") event.target.blur();
        return;
      }
      const onBody = event.target === document.body || event.target?.classList?.contains("present");
      if (event.key === "ArrowRight") goTo(index + 1);
      else if (event.key === "ArrowLeft") goTo(index - 1);
      else if (event.key === "Escape") {
        if (drawer) setDrawer(null);
        else if (selectedNode) setSelectedNode(null);
        else onExit();
      } else if (event.key === " " && onBody) {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key === "Enter" && onBody) runScenario();
      else if (event.key === "n") nextStop();
      else if (event.key === "f") toggleFullscreen();
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, goTo, index, nextStop, onExit, runScenario, selectedNode]);

  const captions = useMemo(() => {
    if (!run) return [];
    return stream.played.filter(
      (item) =>
        item.seq > run.captionSeq &&
        item.event.id > run.startCursor &&
        (run.endCursor == null || item.event.id <= run.endCursor),
    );
  }, [run, stream.played, stream.frame]);

  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions.length]);

  const watched = chapter.watchSource ? sources.find((row) => row.source === chapter.watchSource) : null;
  const info = selectedNode ? infoFor(selectedNode) : null;
  const selectedSource = selectedNode?.startsWith("src:")
    ? sources.find((row) => row.source === NODES[selectedNode].source)
    : null;

  return (
    <div className="present" tabIndex={-1}>
      <header className="p-top">
        <div className="p-brand">
          <span>ClaimPath</span>
          <b>Context Hub, live</b>
        </div>
        <nav className="p-chapters" aria-label="Chapters">
          {CHAPTERS.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={[i === index ? "on" : "", runs[item.id] ? "done" : ""].join(" ")}
              onClick={() => goTo(i)}
              title={item.title}
            >
              <span className="mono">{String(i).padStart(2, "0")}</span>
              <em>{item.kicker}</em>
            </button>
          ))}
        </nav>
        <div className="p-controls">
          <button type="button" className="p-button ghost" onClick={() => setPaused((value) => !value)}>
            {paused ? "Play" : "Pause"}
          </button>
          <div className="p-speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((value) => (
              <button key={value} type="button" className={speed === value ? "on" : ""} onClick={() => setSpeed(value)}>
                {value}x
              </button>
            ))}
          </div>
          <button type="button" className="p-button ghost" onClick={toggleFullscreen}>
            Full screen
          </button>
          <button type="button" className="p-button ghost" onClick={onExit}>
            Exit
          </button>
        </div>
      </header>

      <div className="p-body">
        <main className="p-stage">
          {hubError || stream.error ? <p className="p-error">{hubError || stream.error}</p> : null}
          {chapter.split ? (
            <SplitContext tick={tick} />
          ) : (
            <>
              <FlowMap
                sources={sources}
                overview={overview}
                hits={stream.hits}
                clock={stream.clock}
                tokens={stream.tokens}
                focus={chapter.focus}
                selectedNode={selectedNode}
                onNodeClick={(id) => setSelectedNode((current) => (current === id ? null : id))}
                onTokenClick={(id) => setDrawer(id)}
              />
              <Hud overview={overview} backlog={stream.backlog} paused={paused} />
            </>
          )}
          {drawer ? <RecordDrawer entityId={drawer} tick={tick} onClose={() => setDrawer(null)} /> : null}
        </main>

        <aside className="p-narrator">
          {info ? (
            <section className="p-info">
              <header>
                <span className="mono">{chapter.tour && tourStep >= 0 ? `Stop ${tourStep + 1} of ${chapter.tour.length}` : "On the map"}</span>
                <button type="button" className="p-x" onClick={() => setSelectedNode(null)} aria-label="Close explanation">
                  ×
                </button>
              </header>
              <h3>{selectedSource ? SOURCE_LABEL[selectedSource.source] : info.title}</h3>
              <p>{info.body}</p>
              {selectedSource ? <SourceFacts row={selectedSource} /> : null}
            </section>
          ) : null}

          <p className="p-kicker">
            {String(index).padStart(2, "0")} · {chapter.kicker}
          </p>
          <h2>{chapter.title}</h2>
          <p className="p-claim">{chapter.claim}</p>

          <div className="p-actions">
            {chapter.scenario ? (
              <button type="button" className="p-button primary" disabled={run?.running} onClick={runScenario}>
                {run?.running ? "Running…" : run ? "Run again" : "Run it live"}
              </button>
            ) : null}
            {run && !run.running ? (
              <button type="button" className="p-button ghost" onClick={replay}>
                Replay animation
              </button>
            ) : null}
            {chapter.tour ? (
              <button type="button" className="p-button primary" onClick={nextStop}>
                {tourStep < 0 ? "Walk the path" : "Next stop"}
              </button>
            ) : null}
            {chapter.entity ? (
              <button type="button" className="p-button ghost" onClick={() => setDrawer(chapter.entity)}>
                Open {chapter.entity.split(":")[1]}
              </button>
            ) : null}
          </div>

          <ul className="p-watch">
            {chapter.watch.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {watched ? <WatchedSource row={watched} before={run?.wmBefore} ran={Boolean(run)} /> : null}

          {run ? (
            <section className="p-captions" ref={captionsRef} aria-live="polite">
              {captions.length > CAPTION_LIMIT ? (
                <p className="p-more">{captions.length - CAPTION_LIMIT} earlier steps</p>
              ) : null}
              {captions.slice(-CAPTION_LIMIT).map((item) => (
                <button
                  key={item.seq}
                  type="button"
                  className={`caption stage-${item.event.stage} ${item.kind ? `kind-${item.kind}` : ""}`}
                  onClick={() => setDrawer(item.event.entity_id)}
                >
                  <span className="caption-dot" style={{ background: SOURCE_COLOR[item.event.source] || "#9eb4c6" }} />
                  <span className="caption-stage mono">{STAGE_LABEL[item.event.stage] || item.event.stage}</span>
                  <span className="caption-text">{captionFor(item.event, item.kind)}</span>
                </button>
              ))}
              {!captions.length && !run.running && !run.error ? (
                <p className="p-more">
                  {chapter.watchSource ? "No record moved. That is the point: look at the source." : "Waiting for lineage…"}
                </p>
              ) : null}
              {run.message ? <p className="p-result">{run.message}</p> : null}
              {run.error ? <p className="p-error">{run.error}</p> : null}
            </section>
          ) : null}

          <footer className="p-keys">
            <span><kbd>←</kbd><kbd>→</kbd> chapter</span>
            <span><kbd>Enter</kbd> run</span>
            <span><kbd>Space</kbd> pause</span>
            <span><kbd>Esc</kbd> back</span>
          </footer>
        </aside>
      </div>
    </div>
  );
}

function Hud({ overview, backlog, paused }) {
  const items = overview
    ? [
        [overview.active_count, "active"],
        [overview.stale_count, "stale"],
        [overview.conflict_count, "conflicts"],
        [overview.duplicate_count, "duplicates"],
        [overview.quarantine_count, "quarantined"],
        [overview.dlq_count, "dead letters"],
        [overview.queue_pending, "queued"],
      ]
    : [];
  return (
    <div className="p-hud">
      <div className="p-hud-stats">
        {items.map(([value, label]) => (
          <span key={label} className={value ? "" : "zero"}>
            <b className="mono">{value ?? 0}</b> {label}
          </span>
        ))}
      </div>
      <div className="p-legend">
        <span><i className="lg-dot" /> a record, colored by source</span>
        <span><i className="lg-ring alert" /> failure or quarantine</span>
        <span><i className="lg-ring ok" /> replayed</span>
        {backlog ? <span className="mono">{backlog} steps queued</span> : null}
        {paused ? <span className="paused">paused</span> : null}
      </div>
    </div>
  );
}

function SourceFacts({ row }) {
  return (
    <dl className="facts compact">
      <div><dt>Status</dt><dd className="mono">{row.status}</dd></div>
      <div><dt>Circuit</dt><dd className="mono">{row.circuit}</dd></div>
      <div><dt>Watermark</dt><dd className="mono">{when(row.watermark)}</dd></div>
      <div><dt>Records in hub</dt><dd className="mono">{row.entity_count}</dd></div>
      <div><dt>Stale</dt><dd className="mono">{row.stale_count}</dd></div>
      {row.last_error ? <div><dt>Last error</dt><dd className="mono">{row.last_error}</dd></div> : null}
    </dl>
  );
}

function WatchedSource({ row, before, ran }) {
  const down = row.circuit === "open" || row.outage;
  const moved = ran && before !== undefined && before !== row.watermark;
  return (
    <section className={`p-source ${down ? "down" : "up"}`}>
      <header>
        <b>{SOURCE_LABEL[row.source]}</b>
        <span className={`pill tone-${down ? "alert" : "ok"}`}>{down ? "circuit open" : "healthy"}</span>
      </header>
      <div className="p-wm">
        <div>
          <span>Watermark before</span>
          <b className="mono">{ran ? when(before) : "run to capture"}</b>
        </div>
        <div className={moved ? "moved" : "held"}>
          <span>Watermark now</span>
          <b className="mono">{when(row.watermark)}</b>
          <small>{ran ? (moved ? "moved forward" : "held") : ""}</small>
        </div>
      </div>
      <p className="mono">
        failures {row.failure_count} · stale {row.stale_count} · {row.entity_count} records
      </p>
    </section>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
