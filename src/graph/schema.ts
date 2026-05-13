export type NodeKind =
  | "file"
  | "module"
  | "namespace"
  | "class"
  | "interface"
  | "struct"
  | "trait"
  | "enum"
  | "function"
  | "method"
  | "type"
  | "variable"
  | "service"
  | "process"
  | "runtime"
  | "queue"
  | "topic"
  | "message"
  | "tool"
  | "agent"
  | "flow";

export type EdgeKind =
  | "contains"
  | "defines"
  | "imports"
  | "depends_on"
  | "calls"
  | "references"
  | "reads"
  | "writes"
  | "extends"
  | "implements"
  | "handles"
  | "routes_to"
  | "publishes"
  | "subscribes"
  | "spawns"
  | "waits_for"
  | "sends_message_to"
  | "owns";

export interface SourceSpan {
  file: string | null;
  start_line: number | null;
  end_line: number | null;
}

export interface FunctionNodeMetadata {
  async?: boolean;
  exported?: boolean;
}

export interface ClassNodeMetadata {
  abstract?: boolean;
}

export interface TraitNodeMetadata {
  async?: boolean;
}

export interface TopicNodeMetadata {
  retain?: boolean;
  qos?: number;
}

export type GraphNodeMetadata =
  | FunctionNodeMetadata
  | ClassNodeMetadata
  | TraitNodeMetadata
  | TopicNodeMetadata
  | Record<string, unknown>;

export interface GraphNode {
  id: string;
  kind: NodeKind | string;
  name: string;
  language?: string | null;
  qualified_name?: string | null;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  hash: string | null;
  summary: string | null;
  metadata_json: string | null;
  domain?: string | null;
  subsystem?: string | null;
  cluster_id?: string | null;
  centrality_score?: number | null;
}

export interface GraphEdge {
  id: string;
  from_id: string;
  to_id: string;
  kind: EdgeKind | string;
  confidence: number | null;
  metadata_json: string | null;
  source_file?: string | null;
  source_start_line?: number | null;
  source_end_line?: number | null;
}

export interface GraphFile {
  path: string;
  hash: string | null;
  mtime: number | null;
  language: string | null;
  last_indexed_at: number | null;
  symbol_count?: number | null;
  edge_count?: number | null;
  domain?: string | null;
  subsystem?: string | null;
  centrality_score?: number | null;
}

export interface GraphDoc {
  name: string;
  content: string | null;
  updated_at: number | null;
}

export interface GraphRevision {
  graphRevision: string;
  indexedCommit: string | null;
  workspaceId: string;
  indexedAt: number;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT,
  qualified_name TEXT,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,
  summary TEXT,
  metadata_json TEXT,
  domain TEXT,
  subsystem TEXT,
  cluster_id TEXT,
  centrality_score REAL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL,
  metadata_json TEXT,
  source_file TEXT,
  source_start_line INTEGER,
  source_end_line INTEGER
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT,
  mtime INTEGER,
  language TEXT,
  last_indexed_at INTEGER,
  symbol_count INTEGER,
  edge_count INTEGER,
  domain TEXT,
  subsystem TEXT,
  centrality_score REAL
);

CREATE TABLE IF NOT EXISTS docs (
  name TEXT PRIMARY KEY,
  content TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS graph_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;
