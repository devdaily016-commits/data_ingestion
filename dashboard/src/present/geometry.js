export const VIEW = { w: 1440, h: 640 };

export const SOURCE_ORDER = [
  "sharepoint",
  "ado",
  "jira",
  "rules",
  "quickbase",
  "git",
  "manual_tests",
  "transcripts",
  "jobaids",
  "andisense",
  "socs",
  "srts",
];

export const SOURCE_LABEL = {
  sharepoint: "SharePoint",
  ado: "Azure DevOps",
  jira: "Jira",
  rules: "Rule sheets",
  quickbase: "Quickbase",
  git: "Git",
  manual_tests: "Manual tests",
  transcripts: "Transcripts",
  jobaids: "Job aids",
  andisense: "AndiSense corpus",
  socs: "Controls",
  srts: "SRTS",
};

export const SOURCE_COLOR = {
  sharepoint: "#5ad1c4",
  ado: "#6aa8ff",
  jira: "#8f8bff",
  rules: "#f2c14e",
  quickbase: "#ff9f5a",
  git: "#f07178",
  manual_tests: "#c3e88d",
  transcripts: "#89ddff",
  jobaids: "#ffcb6b",
  andisense: "#c792ea",
  socs: "#b2ccd6",
  srts: "#82aaff",
};

const SRC = { x: 96, w: 156, h: 34, top: 62, gap: 48 };

function sourceNodes() {
  const nodes = {};
  SOURCE_ORDER.forEach((name, index) => {
    nodes[`src:${name}`] = {
      id: `src:${name}`,
      kind: "source",
      source: name,
      x: SRC.x,
      y: SRC.top + index * SRC.gap,
      w: SRC.w,
      h: SRC.h,
      label: SOURCE_LABEL[name],
    };
  });
  return nodes;
}

const STAGE = { w: 100, h: 58 };

export const NODES = {
  ...sourceNodes(),
  webhook: { id: "webhook", kind: "entry", x: 275, y: 200, w: 124, h: 54, label: "Webhook", sub: "id only, refetch" },
  poll: { id: "poll", kind: "entry", x: 275, y: 450, w: 124, h: 54, label: "Delta poll", sub: "from watermark" },
  queue: { id: "queue", kind: "stage", x: 420, y: 325, ...STAGE, label: "Queue", sub: "lock, retry" },
  dlq: { id: "dlq", kind: "exit", x: 420, y: 548, w: 116, h: 54, label: "Retry / DLQ", sub: "3 strikes" },
  check: { id: "check", kind: "check", x: 548, y: 325, w: 96, h: 96, label: "Changed?", sub: "hash + ACL" },
  skipped: { id: "skipped", kind: "exit", x: 548, y: 548, w: 112, h: 54, label: "Unchanged", sub: "stops here" },
  raw: { id: "raw", kind: "stage", x: 676, y: 325, ...STAGE, label: "Raw zone", sub: "immutable" },
  parse: { id: "parse", kind: "stage", x: 796, y: 325, ...STAGE, label: "Parse", sub: "chunks" },
  normalize: { id: "normalize", kind: "stage", x: 916, y: 325, ...STAGE, label: "Normalize", sub: "safety scan" },
  quarantine: { id: "quarantine", kind: "exit", x: 916, y: 548, w: 116, h: 54, label: "Quarantine", sub: "kept, not served" },
  enrich: { id: "enrich", kind: "stage", x: 1036, y: 325, ...STAGE, label: "Enrich", sub: "link, embed" },
  hub: { id: "hub", kind: "store", x: 1160, y: 215, w: 118, h: 64, label: "Context Hub", sub: "entities, versions" },
  index: { id: "index", kind: "store", x: 1160, y: 435, w: 118, h: 64, label: "Search index", sub: "keyword + vector" },
  api: { id: "api", kind: "api", x: 1284, y: 325, w: 100, h: 64, label: "Context API", sub: "ACL-trimmed" },
  sam: { id: "sam", kind: "person", x: 1388, y: 255, w: 82, h: 46, label: "Sam", sub: "public only" },
  alex: { id: "alex", kind: "person", x: 1388, y: 395, w: 82, h: 46, label: "Alex", sub: "+ restricted" },
};

function sourceEdges() {
  const edges = [];
  SOURCE_ORDER.forEach((name) => {
    edges.push({ from: `src:${name}`, to: "webhook", kind: "source" });
    edges.push({ from: `src:${name}`, to: "poll", kind: "source" });
  });
  return edges;
}

export const EDGES = [
  ...sourceEdges(),
  { from: "webhook", to: "queue" },
  { from: "poll", to: "queue" },
  { from: "queue", to: "check" },
  { from: "check", to: "raw" },
  { from: "check", to: "skipped", fs: "b", ts: "t", kind: "exit" },
  { from: "raw", to: "parse" },
  { from: "parse", to: "normalize" },
  { from: "normalize", to: "enrich" },
  { from: "normalize", to: "quarantine", fs: "b", ts: "t", kind: "exit" },
  { from: "enrich", to: "hub" },
  { from: "hub", to: "index", fs: "b", ts: "t" },
  { from: "raw", to: "hub", fs: "t", ts: "l", kind: "tomb", label: "delete" },
  { from: "normalize", to: "hub", fs: "t", ts: "l", kind: "acl", label: "ACL only" },
  { from: "queue", to: "dlq", fs: "b", ts: "t", fo: -22, to_: -22, kind: "exit" },
  { from: "dlq", to: "queue", fs: "t", ts: "b", fo: 22, to_: 22, kind: "replay" },
  { from: "hub", to: "api" },
  { from: "index", to: "api" },
  { from: "api", to: "sam" },
  { from: "api", to: "alex" },
].map((edge) => ({ ...edge, key: `${edge.from}>${edge.to}`, curve: curveFor(edge) }));

export const EDGE_BY_KEY = Object.fromEntries(EDGES.map((edge) => [edge.key, edge]));

function anchor(node, side, offset = 0) {
  const halfW = node.w / 2;
  const halfH = node.h / 2;
  if (side === "r") return { x: node.x + halfW, y: node.y + offset };
  if (side === "l") return { x: node.x - halfW, y: node.y + offset };
  if (side === "t") return { x: node.x + offset, y: node.y - halfH };
  return { x: node.x + offset, y: node.y + halfH };
}

function push(point, side, k) {
  if (side === "r") return { x: point.x + k, y: point.y };
  if (side === "l") return { x: point.x - k, y: point.y };
  if (side === "t") return { x: point.x, y: point.y - k };
  return { x: point.x, y: point.y + k };
}

export function curveFor({ from, to, fs = "r", ts = "l", fo = 0, to_ = 0 }) {
  const a = NODES[from];
  const b = NODES[to];
  const p0 = anchor(a, fs, fo);
  const p3 = anchor(b, ts, to_);
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const k = Math.max(24, dist / 2.4);
  return [p0, push(p0, fs, k), push(p3, ts, k), p3];
}

export function straightCurve(from, to) {
  const a = NODES[from];
  const b = NODES[to];
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };
  return [p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3];
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function curvePath([p0, p1, p2, p3]) {
  return `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}

export function pointOn([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function segmentFor(from, to) {
  const edge = EDGE_BY_KEY[`${from}>${to}`];
  return { key: `${from}>${to}`, curve: edge ? edge.curve : straightCurve(from, to) };
}
