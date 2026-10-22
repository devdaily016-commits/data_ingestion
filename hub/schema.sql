CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS authority_rule (
  entity_type TEXT NOT NULL,
  source TEXT NOT NULL,
  rank INT NOT NULL,
  PRIMARY KEY (entity_type, source)
);

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  body TEXT,
  version INT NOT NULL DEFAULT 1,
  content_hash TEXT,
  body_hash TEXT,
  source_version TEXT,
  source_uri TEXT,
  modified_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  authority_rank INT,
  acl_principals TEXT[] NOT NULL DEFAULT '{}',
  stale_since TIMESTAMPTZ,
  parser_version TEXT,
  raw_blob_path TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  flags TEXT[] NOT NULL DEFAULT '{}',
  logical_key TEXT,
  attributes JSONB NOT NULL DEFAULT '{}',
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS entity_source_idx ON entity (source);
CREATE INDEX IF NOT EXISTS entity_logical_idx ON entity (logical_key);

CREATE TABLE IF NOT EXISTS entity_version (
  id BIGSERIAL PRIMARY KEY,
  entity_id TEXT NOT NULL,
  version INT NOT NULL,
  content_hash TEXT,
  title TEXT,
  body TEXT,
  modified_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ,
  raw_blob_path TEXT,
  change_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  ordinal INT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(64),
  locator JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
);

CREATE INDEX IF NOT EXISTS chunk_tsv_idx ON chunk USING GIN (tsv);
CREATE INDEX IF NOT EXISTS chunk_entity_idx ON chunk (entity_id);

CREATE TABLE IF NOT EXISTS edge (
  id BIGSERIAL PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT,
  method TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (from_id, to_id, type)
);

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  watermark TIMESTAMPTZ,
  cursor TEXT,
  last_sync_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'idle',
  circuit TEXT NOT NULL DEFAULT 'closed',
  last_error TEXT,
  entity_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingest_run (
  id BIGSERIAL PRIMARY KEY,
  source TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  mode TEXT,
  received INT NOT NULL DEFAULT 0,
  upserted INT NOT NULL DEFAULT 0,
  noop INT NOT NULL DEFAULT 0,
  deleted INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  quarantined INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT
);

CREATE TABLE IF NOT EXISTS lineage_event (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id BIGINT,
  entity_id TEXT,
  source TEXT,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS lineage_id_idx ON lineage_event (id DESC);

CREATE TABLE IF NOT EXISTS conflict (
  id BIGSERIAL PRIMARY KEY,
  logical_key TEXT NOT NULL,
  field TEXT NOT NULL,
  winner_id TEXT,
  loser_id TEXT,
  winner_value TEXT,
  loser_value TEXT,
  winner_source TEXT,
  loser_source TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS dlq_item (
  id BIGSERIAL PRIMARY KEY,
  source TEXT,
  payload JSONB NOT NULL,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS queue_message (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS queue_pending_idx ON queue_message (available_at);

INSERT INTO authority_rule (entity_type, source, rank) VALUES
  ('business_requirement', 'sharepoint', 1),
  ('business_requirement', 'jira', 3),
  ('business_requirement', 'transcripts', 4),
  ('business_requirement', 'andisense', 5),
  ('story', 'jira', 1),
  ('story', 'ado', 2),
  ('epic', 'ado', 1),
  ('feature', 'ado', 1),
  ('config_rule', 'rules', 1),
  ('config_rule', 'quickbase', 2),
  ('code', 'git', 1),
  ('test', 'manual_tests', 1),
  ('job_aid', 'jobaids', 1),
  ('job_aid', 'andisense', 2),
  ('knowledge_article', 'andisense', 5),
  ('knowledge_article', 'jobaids', 1),
  ('control', 'socs', 1),
  ('trace', 'srts', 1),
  ('meeting', 'transcripts', 1)
ON CONFLICT (entity_type, source) DO NOTHING;
