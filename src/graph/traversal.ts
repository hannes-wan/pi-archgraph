import Database from "better-sqlite3";
import { GraphEdge, GraphNode } from "./schema.js";
import { isArchitectureEdgeKind } from "./semantics.js";

export interface GraphNeighbor {
  edge: GraphEdge;
  node: GraphNode | null;
}

export interface ReachableNode extends GraphNode {
  path_length: number;
  via_edge_kind: string;
}

export class GraphTraversal {
  constructor(private readonly db: Database.Database) {}

  neighbors(nodeId: string): GraphNeighbor[] {
    return [...this.outbound(nodeId), ...this.inbound(nodeId)];
  }

  outbound(nodeId: string, kinds?: string[]): GraphNeighbor[] {
    return this.queryNeighbors("from_id", "to_id", nodeId, kinds);
  }

  inbound(nodeId: string, kinds?: string[]): GraphNeighbor[] {
    return this.queryNeighbors("to_id", "from_id", nodeId, kinds);
  }

  reachable(nodeId: string, depth: number = 2, direction: "outbound" | "inbound" = "outbound", architectureOnly: boolean = true): ReachableNode[] {
    const sourceColumn = direction === "outbound" ? "from_id" : "to_id";
    const targetColumn = direction === "outbound" ? "to_id" : "from_id";
    const edgeKindFilter = architectureOnly ? "AND e.kind NOT IN ('contains', 'defines')" : "";

    const rows = this.db.prepare(`
      WITH RECURSIVE walk(source_id, target_id, edge_kind, depth_level, path_str) AS (
        SELECT ${sourceColumn}, ${targetColumn}, kind, 1, ',' || ${sourceColumn} || ',' || ${targetColumn} || ','
        FROM edges e
        WHERE ${sourceColumn} = ?
        ${edgeKindFilter}
        UNION ALL
        SELECT e.${sourceColumn}, e.${targetColumn}, e.kind, walk.depth_level + 1, walk.path_str || e.${targetColumn} || ','
        FROM edges e
        JOIN walk ON e.${sourceColumn} = walk.target_id
        WHERE walk.depth_level < ?
        AND instr(walk.path_str, ',' || e.${targetColumn} || ',') = 0
        ${edgeKindFilter}
      )
      SELECT DISTINCT n.*, walk.depth_level as path_length, walk.edge_kind as via_edge_kind
      FROM walk
      JOIN nodes n ON n.id = walk.target_id
      ORDER BY walk.depth_level ASC, n.name ASC
    `).all(nodeId, depth) as ReachableNode[];

    const uniqueNodes = new Map<string, ReachableNode>();
    for (const row of rows) {
      if (!uniqueNodes.has(row.id)) {
        uniqueNodes.set(row.id, { ...row });
      } else {
        const existing = uniqueNodes.get(row.id)!;
        if (row.path_length === existing.path_length) {
          const kinds = existing.via_edge_kind.split(", ");
          if (!kinds.includes(row.via_edge_kind)) {
            existing.via_edge_kind += ", " + row.via_edge_kind;
          }
        }
      }
    }

    return Array.from(uniqueNodes.values()).sort((a, b) => {
      if (a.path_length !== b.path_length) return a.path_length - b.path_length;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  shortestPath(fromId: string, toId: string, maxDepth: number = 8): string[] | null {
    if (fromId === toId) return [fromId];

    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth) continue;

      for (const neighbor of this.outbound(current.id)) {
        if (!neighbor.node || !isArchitectureEdgeKind(neighbor.edge.kind)) continue;
        if (neighbor.node.id === toId) return [...current.path, toId];
        if (!visited.has(neighbor.node.id)) {
          visited.add(neighbor.node.id);
          queue.push({ id: neighbor.node.id, path: [...current.path, neighbor.node.id] });
        }
      }
    }

    return null;
  }

  fanIn(nodeId: string): number {
    return this.countEdges("to_id", nodeId);
  }

  fanOut(nodeId: string): number {
    return this.countEdges("from_id", nodeId);
  }

  centrality(nodeId: string): number {
    const fanIn = this.fanIn(nodeId);
    const fanOut = this.fanOut(nodeId);
    return fanIn * 2 + fanOut;
  }

  private queryNeighbors(sourceColumn: "from_id" | "to_id", targetColumn: "to_id" | "from_id", nodeId: string, kinds?: string[]): GraphNeighbor[] {
    const kindClause = kinds && kinds.length > 0
      ? `AND e.kind IN (${kinds.map(() => "?").join(",")})`
      : "";
    const rows = this.db.prepare(`
      SELECT
        e.id as edge_id,
        e.from_id,
        e.to_id,
        e.kind as edge_kind,
        e.confidence,
        e.metadata_json as edge_metadata_json,
        e.source_file,
        e.source_start_line,
        e.source_end_line,
        n.id as node_id,
        n.kind as node_kind,
        n.name as node_name,
        n.language,
        n.qualified_name,
        n.file_path,
        n.start_line,
        n.end_line,
        n.hash,
        n.summary,
        n.metadata_json as node_metadata_json,
        n.domain,
        n.subsystem,
        n.cluster_id,
        n.centrality_score
      FROM edges e
      LEFT JOIN nodes n ON n.id = e.${targetColumn}
      WHERE e.${sourceColumn} = ?
      ${kindClause}
    `).all(nodeId, ...(kinds ?? [])) as any[];

    return rows.map((row) => ({
      edge: {
        id: row.edge_id,
        from_id: row.from_id,
        to_id: row.to_id,
        kind: row.edge_kind,
        confidence: row.confidence,
        metadata_json: row.edge_metadata_json,
        source_file: row.source_file,
        source_start_line: row.source_start_line,
        source_end_line: row.source_end_line,
      },
      node: row.node_id ? {
        id: row.node_id,
        kind: row.node_kind,
        name: row.node_name,
        language: row.language,
        qualified_name: row.qualified_name,
        file_path: row.file_path,
        start_line: row.start_line,
        end_line: row.end_line,
        hash: row.hash,
        summary: row.summary,
        metadata_json: row.node_metadata_json,
        domain: row.domain,
        subsystem: row.subsystem,
        cluster_id: row.cluster_id,
        centrality_score: row.centrality_score,
      } : null,
    }));
  }

  private countEdges(column: "from_id" | "to_id", nodeId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM edges
      WHERE ${column} = ?
      AND kind NOT IN ('contains', 'defines')
    `).get(nodeId) as { count: number };
    return row.count;
  }
}
