import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const COLUMN_OF = {
  business_requirement: 0,
  control: 0,
  trace: 0,
  epic: 1,
  feature: 1,
  story: 1,
  meeting: 1,
  code: 2,
  config_rule: 2,
  test: 3,
  job_aid: 3,
  knowledge_article: 3,
};
const HEADS = ["Policy", "Work", "Build", "Prove"];

export function GraphScreen({ tick, onSelect }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [mentions, setMentions] = useState(false);
  const [focus, setFocus] = useState(true);

  useEffect(() => {
    api("/api/graph")
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }));
  }, [tick]);

  const layout = useMemo(() => buildLayout(graph, { mentions, focus }), [graph, mentions, focus]);

  return (
    <section>
      <div className="checks">
        <label>
          <input type="checkbox" checked={focus} onChange={(event) => setFocus(event.target.checked)} />
          {" "}Keep to the BR-101 story
        </label>
        <label>
          <input type="checkbox" checked={mentions} onChange={(event) => setMentions(event.target.checked)} />
          {" "}Show mention edges
        </label>
      </div>
      <div className="graph-scroll">
        <svg width={layout.width} height={layout.height} role="img" aria-label="Trace from requirements to code and tests">
          {HEADS.map((label, index) => (
            <text key={label} x={36 + index * 230} y={22} fill="#3e5c73" fontSize="12" fontFamily="Schibsted Grotesk, sans-serif">
              {label}
            </text>
          ))}
          {layout.edges.map((edge) => {
            const from = layout.positions[edge.from_id];
            const to = layout.positions[edge.to_id];
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from_id}-${edge.to_id}-${edge.type}`}
                x1={from.x + 88}
                y1={from.y + 26}
                x2={to.x + 88}
                y2={to.y + 26}
                stroke={strokeFor(edge)}
                strokeWidth={edge.type === "CONFLICTS_WITH" ? 2.2 : 1.2}
                strokeDasharray={edge.method === "id_mention_regex" ? "4 3" : undefined}
              >
                <title>{`${edge.type} · ${edge.method} · ${edge.evidence || ""}`}</title>
              </line>
            );
          })}
          {layout.nodes.map((node) => {
            const pos = layout.positions[node.id];
            const retired = node.deleted || node.status === "tombstoned";
            return (
              <g
                key={node.id}
                className="graph-node"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
                transform={`translate(${pos.x} ${pos.y})`}
              >
                <rect
                  width="176"
                  height="52"
                  rx="2"
                  fill={retired ? "#e7eef5" : "#f7fbff"}
                  stroke={retired ? "#9d1c2b" : "#14304a"}
                  strokeDasharray={retired ? "5 3" : undefined}
                />
                <text x="8" y="20" fill="#14304a" fontSize="12" fontFamily="JetBrains Mono, monospace">
                  {trim(node.source_id, 22)}
                </text>
                <text x="8" y="38" fill="#3e5c73" fontSize="11" fontFamily="Schibsted Grotesk, sans-serif">
                  {trim(node.title || node.type, 26)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="meta">Click a record to open it in the inspector. Dashed boxes are tombstones. Red lines are conflicts.</p>
    </section>
  );
}

function strokeFor(edge) {
  if (edge.type === "CONFLICTS_WITH") return "#9d1c2b";
  if (edge.type === "DUPLICATE_OF") return "#8a5a00";
  if (edge.method === "explicit_link") return "#1f6f8b";
  return "#7fa3bf";
}

function trim(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function buildLayout(graph, options) {
  const edges = (graph.edges || []).filter((edge) => {
    if (!options.mentions && (edge.method === "id_mention_regex" || edge.method === "commit_ref")) return false;
    return edge.active !== false;
  });
  let nodes = graph.nodes || [];
  if (options.focus) {
    const roots = new Set(["BR-101", "BR-102", "RULE-17", "JIRA-502", "QB-9", "JA-12", "AS-44"]);
    const keep = new Set(nodes.filter((node) => roots.has(node.source_id) || roots.has(node.logical_key)).map((node) => node.id));
    for (let depth = 0; depth < 2; depth += 1) {
      edges.forEach((edge) => {
        if (keep.has(edge.from_id)) keep.add(edge.to_id);
        if (keep.has(edge.to_id)) keep.add(edge.from_id);
      });
    }
    nodes = nodes.filter((node) => keep.has(node.id));
  }
  const columns = [[], [], [], [], []];
  nodes.forEach((node) => {
    columns[COLUMN_OF[node.type] ?? 4].push(node);
  });
  const positions = {};
  columns.forEach((column, index) => {
    column.forEach((node, row) => {
      positions[node.id] = { x: 28 + index * 230, y: 36 + row * 70 };
    });
  });
  const height = 80 + Math.max(...columns.map((column) => column.length), 1) * 70;
  return { nodes, edges, positions, width: 28 + 5 * 230, height };
}
