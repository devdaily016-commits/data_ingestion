import { EDGES, NODES, SOURCE_COLOR, VIEW, curvePath, pointOn } from "./geometry";
import { Token } from "./Token";

const LANES = [
  ["Sources", 96],
  ["Connectors", 275],
  ["Workers", 728],
  ["Context Hub", 1160],
  ["Consumers", 1336],
];

const FLASH_MS = 750;

export function FlowMap({
  sources,
  overview,
  hits,
  clock,
  tokens,
  focus,
  selectedNode,
  onNodeClick,
  onTokenClick,
}) {
  const bySource = Object.fromEntries((sources || []).map((row) => [row.source, row]));
  const liveEdges = new Set(tokens.filter((token) => token.segKey).map((token) => token.segKey));
  const focusSet = new Set(focus || []);
  const hasFocus = focusSet.size > 0;

  return (
    <svg className="flow" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-label="Live ingestion flow">
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="arrow-head" />
        </marker>
      </defs>

      {LANES.map(([label, x]) => (
        <text key={label} x={x} y={26} className="lane" textAnchor="middle">
          {label}
        </text>
      ))}

      {EDGES.map((edge) => {
        const live = liveEdges.has(edge.key);
        const sourceDown =
          edge.kind === "source" && bySource[NODES[edge.from].source]?.circuit === "open";
        const mid = pointOn(edge.curve, 0.5);
        return (
          <g key={edge.key}>
            <path
              d={curvePath(edge.curve)}
              className={[
                "edge",
                `edge-${edge.kind || "main"}`,
                live ? "live" : "",
                sourceDown ? "down" : "",
              ].join(" ")}
              markerEnd={edge.kind === "source" ? undefined : "url(#arrow)"}
            />
            {edge.label ? (
              <text x={mid.x} y={mid.y - 6} className="edge-label" textAnchor="middle">
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {Object.values(NODES).map((node) => {
        const hit = hits[node.id];
        const flashing = hit && clock - hit.last < FLASH_MS;
        const dim = hasFocus && !focusSet.has(node.id) && node.kind !== "source";
        const props = {
          node,
          flashing,
          dim,
          selected: selectedNode === node.id,
          spot: focusSet.has(node.id),
          count: hit?.count || 0,
          onClick: () => onNodeClick(node.id),
        };
        if (node.kind === "source") return <SourceNode key={node.id} {...props} state={bySource[node.source]} />;
        if (node.kind === "check") return <CheckNode key={node.id} {...props} />;
        return <StageNode key={node.id} {...props} badge={badgeFor(node.id, overview)} />;
      })}

      {tokens.map((token) => (
        <Token key={token.id} token={token} onClick={() => onTokenClick(token.entityId)} />
      ))}
    </svg>
  );
}

function badgeFor(id, overview) {
  if (!overview) return null;
  if (id === "queue" && overview.queue_pending) return { text: `${overview.queue_pending} waiting`, tone: "warn" };
  if (id === "dlq" && overview.dlq_count) return { text: `${overview.dlq_count} dead`, tone: "alert" };
  if (id === "quarantine" && overview.quarantine_count) return { text: `${overview.quarantine_count} held`, tone: "alert" };
  if (id === "hub") {
    const parts = [`${overview.active_count} live`];
    if (overview.conflict_count) parts.push(`${overview.conflict_count} conflict`);
    if (overview.stale_count) parts.push(`${overview.stale_count} stale`);
    return { text: parts.join(" · "), tone: overview.conflict_count || overview.stale_count ? "warn" : "ok" };
  }
  if (id === "index" && overview.duplicate_count) return { text: `${overview.duplicate_count} dup edges`, tone: "quiet" };
  return null;
}

function nodeClass(base, { flashing, dim, selected, spot }) {
  return [base, flashing ? "flash" : "", dim ? "dim" : "", selected ? "selected" : "", spot ? "spot" : ""].join(" ");
}

function keyHandler(onClick) {
  return (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }
  };
}

function SourceNode({ node, state, onClick, ...flags }) {
  const down = state?.circuit === "open" || state?.outage;
  const color = SOURCE_COLOR[node.source];
  const x = node.x - node.w / 2;
  const y = node.y - node.h / 2;
  return (
    <g
      className={nodeClass(`node source ${down ? "down" : ""}`, flags)}
      onClick={onClick}
      onKeyDown={keyHandler(onClick)}
      role="button"
      tabIndex={0}
      aria-label={`${node.label} source`}
    >
      <rect x={x} y={y} width={node.w} height={node.h} rx={9} className="shape" />
      <circle cx={x + 13} cy={node.y} r={4.5} fill={down ? "var(--p-alert)" : color} />
      <text x={x + 25} y={node.y - 3} className="node-label small">
        {node.label}
      </text>
      <text x={x + 25} y={node.y + 10} className="node-sub mono">
        {down ? (state?.outage ? "down · watermark frozen" : "circuit open") : `wm ${shortTime(state?.watermark)}`}
      </text>
      <text x={x + node.w - 9} y={node.y + 4} className="node-count mono" textAnchor="end">
        {state?.entity_count ?? "·"}
      </text>
      {state?.stale_count ? (
        <text x={x + node.w - 9} y={node.y - 7} className="node-stale mono" textAnchor="end">
          {state.stale_count} stale
        </text>
      ) : null}
    </g>
  );
}

function CheckNode({ node, count, onClick, ...flags }) {
  const r = node.w / 2;
  const points = `${node.x},${node.y - r} ${node.x + r},${node.y} ${node.x},${node.y + r} ${node.x - r},${node.y}`;
  return (
    <g
      className={nodeClass("node check", flags)}
      onClick={onClick}
      onKeyDown={keyHandler(onClick)}
      role="button"
      tabIndex={0}
      aria-label={node.label}
    >
      <polygon points={points} className="shape" />
      <text x={node.x} y={node.y - 2} className="node-label" textAnchor="middle">
        {node.label}
      </text>
      <text x={node.x} y={node.y + 14} className="node-sub" textAnchor="middle">
        {node.sub}
      </text>
      {count ? <Counter x={node.x + r - 6} y={node.y - r + 10} value={count} /> : null}
    </g>
  );
}

function StageNode({ node, count, badge, onClick, ...flags }) {
  const x = node.x - node.w / 2;
  const y = node.y - node.h / 2;
  const used = count > 0 || badge;
  return (
    <g
      className={nodeClass(`node ${node.kind} ${node.kind === "exit" && !used ? "idle" : ""}`, flags)}
      onClick={onClick}
      onKeyDown={keyHandler(onClick)}
      role="button"
      tabIndex={0}
      aria-label={node.label}
    >
      <rect x={x} y={y} width={node.w} height={node.h} rx={node.kind === "person" ? node.h / 2 : 10} className="shape" />
      <text x={node.x} y={node.y - 2} className="node-label" textAnchor="middle">
        {node.label}
      </text>
      <text x={node.x} y={node.y + 14} className="node-sub" textAnchor="middle">
        {node.sub}
      </text>
      {count ? <Counter x={x + node.w - 2} y={y + 2} value={count} /> : null}
      {badge ? (
        <text x={node.x} y={y - 8} className={`node-badge tone-${badge.tone}`} textAnchor="middle">
          {badge.text}
        </text>
      ) : null}
    </g>
  );
}

function Counter({ x, y, value }) {
  return (
    <g className="counter">
      <circle cx={x} cy={y} r={11} />
      <text x={x} y={y + 4} textAnchor="middle" className="mono">
        {value > 99 ? "99+" : value}
      </text>
    </g>
  );
}

function shortTime(value) {
  if (!value) return "none yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
