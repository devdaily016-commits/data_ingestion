import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { NODES, pointOn, segmentFor } from "./geometry";

const HOP_MS = 560;
const START_GAP_MS = 110;
const POLL_MS = 800;
const LOG_LIMIT = 3000;
const MAX_ATTEMPTS = 3;
const TERMINAL = new Set(["noop", "quarantined", "indexed", "tombstoned", "failed", "acl"]);

function baseRoute(event, token, failures) {
  const source = `src:${event.source}`;
  const at = token?.node;
  switch (event.stage) {
    case "received": {
      if ((failures.get(event.entity_id) || 0) > 0) return ["dlq", "queue"];
      const entry = event.run_id ? "poll" : "webhook";
      return NODES[source] ? [source, entry, "queue"] : [entry, "queue"];
    }
    case "noop":
      return !at || at === "queue" ? ["queue", "check", "skipped"] : [at, "skipped"];
    case "raw":
      return ["queue", "check", "raw"];
    case "parsed":
      return ["raw", "parse"];
    case "normalized":
      return ["parse", "normalize"];
    case "quarantined":
      return ["normalize", "quarantine"];
    case "acl":
      return ["normalize", "hub"];
    case "enriched":
      return ["normalize", "enrich"];
    case "indexed":
      return ["enrich", "hub", "index"];
    case "tombstoned":
      return ["raw", "hub"];
    case "failed":
      return ["queue", "dlq"];
    default:
      return at ? [at] : ["queue"];
  }
}

function joinRoute(route, at) {
  if (!at) return route;
  const index = route.indexOf(at);
  if (index >= 0) return route.slice(index);
  return [at, ...route];
}

function ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function retryKind(event, failuresBefore) {
  if (event.stage !== "received" || !failuresBefore) return null;
  return failuresBefore >= MAX_ATTEMPTS ? "replay" : "retry";
}

function createEngine() {
  return {
    clock: 0,
    lastStart: -Infinity,
    seq: 0,
    tokens: new Map(),
    pending: new Map(),
    failures: new Map(),
    routes: new Map(),
    played: [],
    hits: {},

    enqueue(events) {
      events.forEach((event) => {
        if (!event.entity_id) return;
        const list = this.pending.get(event.entity_id) || [];
        list.push(event);
        this.pending.set(event.entity_id, list);
      });
    },

    backlog() {
      let total = 0;
      this.pending.forEach((list) => {
        total += list.length;
      });
      return total;
    },

    hit(node) {
      const current = this.hits[node] || { count: 0, last: -Infinity };
      this.hits[node] = { count: current.count + 1, last: this.clock };
    },

    start(event) {
      const token = this.tokens.get(event.entity_id);
      let planned = this.routes.get(event.id);
      if (!planned) {
        const before = this.failures.get(event.entity_id) || 0;
        const route = baseRoute(event, token, this.failures);
        planned = { route, kind: retryKind(event, before) };
        if (event.stage === "failed") this.failures.set(event.entity_id, before + 1);
        if (event.stage === "indexed") this.failures.delete(event.entity_id);
        this.routes.set(event.id, planned);
      }
      const route = token ? joinRoute(planned.route, token.node) : planned.route;
      const segments = [];
      for (let i = 0; i < route.length - 1; i += 1) segments.push(segmentFor(route[i], route[i + 1]));
      const backlog = this.backlog();
      const hopMs = HOP_MS / (backlog > 40 ? 4 : backlog > 15 ? 2 : 1);
      const next = token || {
        id: event.entity_id,
        entityId: event.entity_id,
        source: event.source,
        label: event.entity_id.split(":").slice(1).join(":") || event.entity_id,
        node: route[0],
      };
      next.terminal = false;
      next.stage = event.stage;
      next.kind = planned.kind;
      next.move = { route, segments, startedAt: this.clock, hopMs, event, hitIndex: 0 };
      if (!token) this.hit(route[0]);
      this.tokens.set(event.entity_id, next);
      this.lastStart = this.clock;
    },

    step(dt) {
      this.clock += dt;
      let changed = false;
      this.tokens.forEach((token, id) => {
        const move = token.move;
        if (move) {
          changed = true;
          const total = Math.max(1, move.segments.length) * move.hopMs;
          const progress = Math.min(1, (this.clock - move.startedAt) / total);
          const reached = Math.floor(progress * move.segments.length + 1e-6);
          while (move.hitIndex < reached) {
            move.hitIndex += 1;
            this.hit(move.route[move.hitIndex]);
          }
          if (progress >= 1 || move.segments.length === 0) {
            token.node = move.route[move.route.length - 1];
            token.move = null;
            token.idleSince = this.clock;
            token.terminal = TERMINAL.has(move.event.stage);
            this.seq += 1;
            this.played.push({ seq: this.seq, event: move.event, route: move.route, kind: token.kind });
            if (this.played.length > LOG_LIMIT) this.played.splice(0, this.played.length - LOG_LIMIT);
          }
          return;
        }
        const waiting = this.pending.get(id);
        const linger = token.terminal ? 2600 : 9000;
        if ((!waiting || waiting.length === 0) && this.clock - token.idleSince > linger) {
          this.tokens.delete(id);
          changed = true;
        }
      });
      this.pending.forEach((list, id) => {
        if (list.length === 0) {
          this.pending.delete(id);
          return;
        }
        const token = this.tokens.get(id);
        if (token && token.move) return;
        const gap = START_GAP_MS / (this.backlog() > 15 ? 3 : 1);
        if (!token && this.clock - this.lastStart < gap) return;
        this.start(list.shift());
        changed = true;
      });
      return changed;
    },

    snapshot() {
      const idleByNode = {};
      const tokens = [];
      this.tokens.forEach((token) => {
        if (token.move) {
          const { segments, startedAt, hopMs } = token.move;
          const total = Math.max(1, segments.length) * hopMs;
          const progress = Math.min(1, (this.clock - startedAt) / total);
          const scaled = progress * segments.length;
          const index = Math.min(segments.length - 1, Math.floor(scaled));
          const local = segments.length ? ease(scaled - index) : 1;
          const point = segments.length ? pointOn(segments[index].curve, local) : NODES[token.node];
          tokens.push({ ...token, x: point.x, y: point.y, moving: true, segKey: segments[index]?.key });
          return;
        }
        (idleByNode[token.node] = idleByNode[token.node] || []).push(token);
      });
      Object.entries(idleByNode).forEach(([nodeId, list]) => {
        const node = NODES[nodeId];
        const shown = list.slice(-6);
        shown.forEach((token, i) => {
          const fade = token.terminal ? Math.max(0, 1 - (this.clock - token.idleSince - 1600) / 1000) : 1;
          tokens.push({
            ...token,
            x: node.x + (i - (shown.length - 1) / 2) * 15,
            y: node.y + node.h / 2 + 11,
            moving: false,
            opacity: Math.min(1, fade),
            overflow: i === shown.length - 1 && list.length > shown.length ? list.length - shown.length : 0,
          });
        });
      });
      return tokens;
    },
  };
}

export function useLineageStream({ speed = 1, paused = false } = {}) {
  const engineRef = useRef(null);
  if (engineRef.current === null) engineRef.current = createEngine();
  const cursorRef = useRef(null);
  const logRef = useRef([]);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const [frame, setFrame] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let stop = false;
    let timer = null;
    async function loop() {
      if (stop) return;
      try {
        if (cursorRef.current === null) {
          const latest = await api("/api/lineage?limit=1");
          cursorRef.current = latest.events[0]?.id ?? 0;
        } else {
          const data = await api(`/api/lineage?after_id=${cursorRef.current}&limit=200`);
          if (data.events.length) {
            cursorRef.current = data.events[data.events.length - 1].id;
            logRef.current.push(...data.events);
            if (logRef.current.length > LOG_LIMIT) logRef.current.splice(0, logRef.current.length - LOG_LIMIT);
            engineRef.current.enqueue(data.events);
          }
        }
        if (!stop) {
          setCursor(cursorRef.current);
          setError("");
        }
      } catch (err) {
        if (!stop) setError(err.message || "The hub is not answering.");
      }
      if (!stop) timer = setTimeout(loop, POLL_MS);
    }
    loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let quietFrames = 0;
    const tick = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (!pausedRef.current) {
        const changed = engineRef.current.step(dt * speedRef.current);
        const flashing = Object.values(engineRef.current.hits).some(
          (hit) => engineRef.current.clock - hit.last < 900,
        );
        if (changed || flashing || engineRef.current.tokens.size > 0) {
          quietFrames = 0;
          setFrame((value) => value + 1);
        } else if (quietFrames < 2) {
          quietFrames += 1;
          setFrame((value) => value + 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const replay = useCallback((fromId, toId) => {
    const events = logRef.current.filter((event) => event.id > fromId && (toId == null || event.id <= toId));
    engineRef.current.enqueue(events);
    return engineRef.current.seq;
  }, []);

  const resetHits = useCallback(() => {
    engineRef.current.hits = {};
  }, []);

  const engine = engineRef.current;
  return {
    frame,
    cursor,
    error,
    clock: engine.clock,
    tokens: engine.snapshot(),
    played: engine.played,
    hits: engine.hits,
    seq: engine.seq,
    backlog: engine.backlog(),
    replay,
    resetHits,
  };
}
