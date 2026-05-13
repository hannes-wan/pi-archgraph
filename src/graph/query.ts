import Database from "better-sqlite3";
import { GraphNode } from "./schema.js";

export class GraphQuery {
  constructor(private readonly db: Database.Database) {}

  searchSymbols(query: string, limit: number = 10): GraphNode[] {
    const escaped = `%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    return this.db.prepare(`
      SELECT *
      FROM nodes
      WHERE instr(lower(name), lower(?)) > 0
        OR instr(lower(COALESCE(qualified_name, '')), lower(?)) > 0
        OR instr(lower(COALESCE(summary, '')), lower(?)) > 0
        OR instr(lower(COALESCE(domain, '')), lower(?)) > 0
        OR instr(lower(COALESCE(subsystem, '')), lower(?)) > 0
      ORDER BY
        CASE kind
          WHEN 'function' THEN 0
          WHEN 'method' THEN 1
          WHEN 'class' THEN 2
          ELSE 3
        END,
        CASE
          WHEN lower(qualified_name) = lower(?) THEN 0
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
    `).all(query, query, query, query, query, query, query, query, query, query, limit) as GraphNode[];
  }

  findNodeByName(name: string): GraphNode[] {
    return this.db.prepare(`
      SELECT *
      FROM nodes
      WHERE name = ? COLLATE NOCASE OR qualified_name = ? COLLATE NOCASE
    `).all(name, name) as GraphNode[];
  }

  getFileNodes(filePath: string): GraphNode[] {
    return this.db.prepare(`SELECT * FROM nodes WHERE file_path = ?`).all(filePath) as GraphNode[];
  }
}
