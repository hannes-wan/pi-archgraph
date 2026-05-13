import Database from "better-sqlite3";
import { GraphNode } from "./schema.js";
import { GraphTraversal } from "./traversal.js";

export function findNodeByName(db: Database.Database, name: string): GraphNode[] {
  return db.prepare(`
    SELECT *
    FROM nodes
    WHERE name = ? COLLATE NOCASE OR qualified_name = ? COLLATE NOCASE
  `).all(name, name) as GraphNode[];
}

export function getNodeDependencies(db: Database.Database, id: string, depth: number = 2): any[] {
  const traversal = new GraphTraversal(db);
  return traversal.reachable(id, depth, "outbound", true);
}

export function getNodeCallers(db: Database.Database, id: string, depth: number = 2): any[] {
  const traversal = new GraphTraversal(db);
  return traversal.reachable(id, depth, "inbound", true);
}

export function getFileNodes(db: Database.Database, file_path: string): GraphNode[] {
  return db.prepare(`SELECT * FROM nodes WHERE file_path = ?`).all(file_path) as GraphNode[];
}

export function searchSymbols(db: Database.Database, query: string, limit: number = 10): GraphNode[] {
  return db.prepare(`
    SELECT *
    FROM nodes
    ORDER BY
      CASE kind
        WHEN 'function' THEN 0
        WHEN 'method' THEN 1
        WHEN 'class' THEN 2
        ELSE 3
      END,
      CASE
        WHEN lower(COALESCE(qualified_name, '')) = lower(?) THEN 0
        WHEN lower(name) = lower(?) THEN 1
        WHEN instr(lower(COALESCE(summary, '')), lower(?)) > 0 THEN 2
        WHEN instr(lower(COALESCE(domain, '')), lower(?)) > 0 THEN 3
        WHEN instr(lower(COALESCE(subsystem, '')), lower(?)) > 0 THEN 4
        ELSE 5
      END,
      (
        COALESCE(centrality_score, 0)
        + CASE WHEN domain IS NOT NULL AND domain != '' THEN 2 ELSE 0 END
        + CASE WHEN subsystem IS NOT NULL AND subsystem != '' THEN 1 ELSE 0 END
        + CASE WHEN summary IS NOT NULL AND summary != '' THEN 1 ELSE 0 END
        + CASE WHEN qualified_name IS NOT NULL AND qualified_name != '' THEN 0.5 ELSE 0 END
        + CASE WHEN kind IN ('function', 'method') THEN 1 ELSE 0 END
      ) DESC,
      COALESCE(centrality_score, 0) DESC
    LIMIT ?
  `).all(query, query, query, query, query, limit) as GraphNode[];
}
