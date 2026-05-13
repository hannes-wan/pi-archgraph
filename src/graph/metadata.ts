import Database from "better-sqlite3";
import { GraphRevision } from "./schema.js";

export function setGraphRevision(db: Database.Database, revision: GraphRevision): void {
  const insert = db.prepare(`
    INSERT INTO graph_metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  insert.run("graphRevision", revision.graphRevision);
  insert.run("indexedCommit", revision.indexedCommit);
  insert.run("workspaceId", revision.workspaceId);
  insert.run("indexedAt", String(revision.indexedAt));
}

export function getGraphRevision(db: Database.Database): GraphRevision | null {
  const rows = db.prepare(`SELECT key, value FROM graph_metadata`).all() as Array<{ key: string; value: string | null }>;
  if (rows.length === 0) return null;

  const values = new Map(rows.map((row) => [row.key, row.value]));
  const graphRevision = values.get("graphRevision");
  const workspaceId = values.get("workspaceId");
  const indexedAt = values.get("indexedAt");
  if (!graphRevision || !workspaceId || !indexedAt) return null;

  return {
    graphRevision,
    indexedCommit: values.get("indexedCommit") ?? null,
    workspaceId,
    indexedAt: Number(indexedAt),
  };
}
