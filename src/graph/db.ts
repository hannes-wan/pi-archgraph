import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { GraphEdge, GraphNode, SCHEMA_SQL } from "./schema.js";

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const pragma = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  const columns = pragma?.map((row) => row.name) ?? [];
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureTable(db: Database.Database, table: string, createSql: string): void {
  db.exec(createSql);
  const existing = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table);
  if (!existing) {
    throw new Error(`Failed to create required table '${table}'`);
  }
}

function migrateSchema(db: Database.Database): void {
  ensureColumn(db, "nodes", "language", "TEXT");
  ensureColumn(db, "nodes", "qualified_name", "TEXT");
  ensureColumn(db, "nodes", "domain", "TEXT");
  ensureColumn(db, "nodes", "subsystem", "TEXT");
  ensureColumn(db, "nodes", "cluster_id", "TEXT");
  ensureColumn(db, "nodes", "centrality_score", "REAL");

  ensureColumn(db, "edges", "source_file", "TEXT");
  ensureColumn(db, "edges", "source_start_line", "INTEGER");
  ensureColumn(db, "edges", "source_end_line", "INTEGER");

  ensureColumn(db, "files", "symbol_count", "INTEGER");
  ensureColumn(db, "files", "edge_count", "INTEGER");
  ensureColumn(db, "files", "domain", "TEXT");
  ensureColumn(db, "files", "subsystem", "TEXT");
  ensureColumn(db, "files", "centrality_score", "REAL");

  ensureTable(db, "graph_metadata", "CREATE TABLE IF NOT EXISTS graph_metadata (key TEXT PRIMARY KEY, value TEXT)");

  db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_domain ON nodes(domain)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_cluster_id ON nodes(cluster_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_domain ON files(domain)");
}

export function getDb(archgraphDir: string): Database.Database {
  if (!fs.existsSync(archgraphDir)) {
    fs.mkdirSync(archgraphDir, { recursive: true });
  }

  const dbPath = path.join(archgraphDir, "graph.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

export type { GraphNode, GraphEdge };
export { SCHEMA_SQL };
