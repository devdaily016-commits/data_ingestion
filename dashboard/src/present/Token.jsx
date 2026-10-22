import { SOURCE_COLOR } from "./geometry";

const STAGE_TONE = {
  quarantined: "alert",
  failed: "alert",
  tombstoned: "quiet",
  noop: "quiet",
  acl: "warn",
};

export function Token({ token, onClick }) {
  const color = SOURCE_COLOR[token.source] || "#e7eef5";
  const tone = token.kind === "retry" ? "alert" : token.kind === "replay" ? "ok" : STAGE_TONE[token.stage];
  return (
    <g
      className={`token ${token.moving ? "moving" : "resting"} ${tone ? `tone-${tone}` : ""}`}
      transform={`translate(${token.x} ${token.y})`}
      style={{ opacity: token.opacity ?? 1 }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      role="button"
      aria-label={`Open ${token.entityId}`}
    >
      <circle r={token.moving ? 8 : 5.5} fill={color} filter={token.moving ? "url(#glow)" : undefined} />
      {tone ? <circle r={token.moving ? 12 : 8.5} className="token-ring" /> : null}
      {token.moving ? (
        <text y={-15} textAnchor="middle" className="token-label mono">
          {token.label}
        </text>
      ) : null}
      {token.overflow ? (
        <text x={12} y={4} className="token-more mono">
          +{token.overflow}
        </text>
      ) : null}
    </g>
  );
}
