import Database from "better-sqlite3";
import * as path from "node:path";
import { buildClusterId, inferDomain, inferSubsystem } from "./domains.js";
import { GraphNode, GraphEdge, GraphFile } from "./schema.js";
import { validateEdgeDirection } from "./semantics.js";
import { extractSymbolCandidates } from "../frontends/edge-targets.js";

function enrichNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => {
    const domain = node.domain ?? (node.file_path ? inferDomain(node.file_path) : null);
    const subsystem = node.subsystem ?? (node.file_path ? inferSubsystem(node.file_path) : null);
    return {
      ...node,
      domain,
      subsystem,
      cluster_id: node.cluster_id ?? (domain && subsystem ? buildClusterId(domain, subsystem) : null),
      centrality_score: node.centrality_score ?? null,
    };
  });
}

function enrichEdges(
  db: Database.Database,
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>
): GraphEdge[] {
  const resolutionCache = new Map<string, string>();

  return edges.map((edge) => {
    validateEdgeDirection(edge);
    const resolvedFromId = resolveEdgeEndpoint(db, edge.from_id, edge.kind, edge.source_file ?? null, nodesById, resolutionCache);
    const resolvedToId = resolveEdgeEndpoint(db, edge.to_id, edge.kind, edge.source_file ?? null, nodesById, resolutionCache);
    const sourceNode = nodesById.get(resolvedFromId) ?? getNodeById(db, resolvedFromId);
    return {
      ...edge,
      from_id: resolvedFromId,
      to_id: resolvedToId,
      source_file: edge.source_file ?? sourceNode?.file_path ?? null,
      source_start_line: edge.source_start_line ?? sourceNode?.start_line ?? null,
      source_end_line: edge.source_end_line ?? sourceNode?.end_line ?? null,
    };
  });
}

function enrichFiles(files: GraphFile[], nodes: GraphNode[], edges: GraphEdge[]): GraphFile[] {
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();

  for (const node of nodes) {
    if (!node.file_path) continue;
    nodeCounts.set(node.file_path, (nodeCounts.get(node.file_path) ?? 0) + 1);
  }

  for (const edge of edges) {
    if (!edge.source_file) continue;
    edgeCounts.set(edge.source_file, (edgeCounts.get(edge.source_file) ?? 0) + 1);
  }

  return files.map((file) => {
    const domain = file.domain ?? inferDomain(file.path);
    const subsystem = file.subsystem ?? inferSubsystem(file.path);
    return {
      ...file,
      symbol_count: file.symbol_count ?? nodeCounts.get(file.path) ?? 0,
      edge_count: file.edge_count ?? edgeCounts.get(file.path) ?? 0,
      domain,
      subsystem,
      centrality_score: file.centrality_score ?? null,
    };
  });
}

export function patchGraph(
  db: Database.Database,
  files: GraphFile[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  deletedFiles: string[] = []
) {
  const enrichedNodes = enrichNodes(nodes);
  const nodeMap = new Map(enrichedNodes.map((node) => [node.id, node]));
  const enrichedEdges = enrichEdges(db, edges, nodeMap);
  const enrichedFiles = enrichFiles(files, enrichedNodes, enrichedEdges);

  const insertFile = db.prepare(`
    INSERT INTO files (path, hash, mtime, language, last_indexed_at, symbol_count, edge_count, domain, subsystem, centrality_score)
    VALUES (@path, @hash, @mtime, @language, @last_indexed_at, @symbol_count, @edge_count, @domain, @subsystem, @centrality_score)
    ON CONFLICT(path) DO UPDATE SET
      hash = excluded.hash,
      mtime = excluded.mtime,
      language = excluded.language,
      last_indexed_at = excluded.last_indexed_at,
      symbol_count = excluded.symbol_count,
      edge_count = excluded.edge_count,
      domain = excluded.domain,
      subsystem = excluded.subsystem,
      centrality_score = excluded.centrality_score
  `);

  const deleteFile = db.prepare(`DELETE FROM files WHERE path = ?`);
  const deleteNodesByFile = db.prepare(`DELETE FROM nodes WHERE file_path = ?`);
  const deleteEdgesBySourceFile = db.prepare(`DELETE FROM edges WHERE source_file = ?`);

  const insertNode = db.prepare(`
    INSERT INTO nodes (id, kind, name, language, qualified_name, file_path, start_line, end_line, hash, summary, metadata_json, domain, subsystem, cluster_id, centrality_score)
    VALUES (@id, @kind, @name, @language, @qualified_name, @file_path, @start_line, @end_line, @hash, @summary, @metadata_json, @domain, @subsystem, @cluster_id, @centrality_score)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      name = excluded.name,
      language = excluded.language,
      qualified_name = excluded.qualified_name,
      file_path = excluded.file_path,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      hash = excluded.hash,
      summary = excluded.summary,
      metadata_json = excluded.metadata_json,
      domain = excluded.domain,
      subsystem = excluded.subsystem,
      cluster_id = excluded.cluster_id,
      centrality_score = excluded.centrality_score
  `);

  const insertEdge = db.prepare(`
    INSERT INTO edges (id, from_id, to_id, kind, confidence, metadata_json, source_file, source_start_line, source_end_line)
    VALUES (@id, @from_id, @to_id, @kind, @confidence, @metadata_json, @source_file, @source_start_line, @source_end_line)
    ON CONFLICT(id) DO UPDATE SET
      from_id = excluded.from_id,
      to_id = excluded.to_id,
      kind = excluded.kind,
      confidence = excluded.confidence,
      metadata_json = excluded.metadata_json,
      source_file = excluded.source_file,
      source_start_line = excluded.source_start_line,
      source_end_line = excluded.source_end_line
  `);

  const transaction = db.transaction(() => {
    for (const filePath of deletedFiles) {
      deleteFile.run(filePath);
      deleteNodesByFile.run(filePath);
      deleteEdgesBySourceFile.run(filePath);
    }

    const updatedFilePaths = new Set(enrichedFiles.map((file) => file.path));
    for (const filePath of updatedFilePaths) {
      deleteNodesByFile.run(filePath);
      deleteEdgesBySourceFile.run(filePath);
    }

    for (const file of enrichedFiles) {
      insertFile.run(file);
    }

    for (const node of enrichedNodes) {
      insertNode.run(node);
    }

    for (const edge of enrichedEdges) {
      insertEdge.run(edge);
    }
  });

  transaction();
}

function resolveEdgeEndpoint(
  db: Database.Database,
  rawId: string,
  edgeKind: string,
  sourceFile: string | null,
  nodesById: Map<string, GraphNode>,
  cache: Map<string, string>
): string {
  const cacheKey = `${edgeKind}:${sourceFile ?? ""}:${rawId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (nodesById.has(rawId) || getNodeById(db, rawId)) {
    cache.set(cacheKey, rawId);
    return rawId;
  }

  const resolved =
    resolveFileNodeId(db, rawId, nodesById) ??
    resolveSymbolNodeId(db, rawId, edgeKind, sourceFile, nodesById) ??
    rawId;

  cache.set(cacheKey, resolved);
  return resolved;
}

function resolveFileNodeId(
  db: Database.Database,
  rawId: string,
  nodesById: Map<string, GraphNode>
): string | null {
  const normalized = rawId.startsWith("file:") ? rawId.slice(5) : rawId;
  const fileNodeId = `file:${normalized}`;
  if (nodesById.has(fileNodeId) || getNodeById(db, fileNodeId)) {
    return fileNodeId;
  }

  const directPathNode = findSingleNode(db, `
    SELECT *
    FROM nodes
    WHERE kind = 'file' AND file_path = ?
    LIMIT 2
  `, [normalized]);
  if (directPathNode) return directPathNode.id;

  const basename = path.basename(normalized);
  if (!basename || basename === normalized) return null;

  const basenameNode = findSingleNode(db, `
    SELECT *
    FROM nodes
    WHERE kind = 'file' AND file_path LIKE ?
    LIMIT 2
  `, [`%/${basename}`]);
  return basenameNode?.id ?? null;
}

function resolveSymbolNodeId(
  db: Database.Database,
  rawId: string,
  edgeKind: string,
  sourceFile: string | null,
  nodesById: Map<string, GraphNode>
): string | null {
  const token = rawId.trim();
  if (!token) return null;

  const candidates = collectNodeCandidates(db, token, nodesById);
  if (candidates.length === 0) return null;

  const filtered = rankNodeCandidates(candidates, edgeKind, sourceFile);
  if (filtered.length === 1) return filtered[0].id;
  if (filtered.length > 1 && filtered[0].score > filtered[1].score) return filtered[0].id;
  return null;
}

function collectNodeCandidates(
  db: Database.Database,
  token: string,
  nodesById: Map<string, GraphNode>
): GraphNode[] {
  const candidates = extractSymbolCandidates(token);
  if (candidates.length === 0) return [];

  const localCandidates = [...nodesById.values()].filter((node) =>
    candidates.some((candidate) =>
      node.name === candidate ||
      node.qualified_name === candidate ||
      node.qualified_name?.endsWith(`::${candidate}`) ||
      node.qualified_name?.endsWith(`.${candidate}`) ||
      node.file_path === candidate ||
      path.basename(node.file_path ?? "") === candidate
    )
  );

  if (localCandidates.length > 0) return dedupeNodes(localCandidates);

  const dbCandidates = db.prepare(`
    SELECT *
    FROM nodes
    WHERE
      ${candidates.map(() => `
        name = ? COLLATE NOCASE OR
        qualified_name = ? COLLATE NOCASE OR
        qualified_name LIKE ? COLLATE NOCASE OR
        qualified_name LIKE ? COLLATE NOCASE OR
        file_path = ? OR
        file_path LIKE ?
      `).join(" OR ")}
    LIMIT 12
  `).all(...candidates.flatMap((candidate) => [
    candidate,
    candidate,
    `%::${candidate}`,
    `%.${candidate}`,
    candidate,
    `%/${path.basename(candidate)}`,
  ])) as GraphNode[];

  return dedupeNodes(dbCandidates);
}

function rankNodeCandidates(
  candidates: GraphNode[],
  edgeKind: string,
  sourceFile: string | null
): Array<GraphNode & { score: number }> {
  return candidates
    .map((node) => {
      let score = 0;
      if (node.name === path.basename(node.name)) score += 1;
      if (sourceFile && node.file_path) {
        const sourceDir = path.dirname(sourceFile);
        const nodeDir = path.dirname(node.file_path);
        if (sourceDir === nodeDir) score += 4;
        if (node.file_path.startsWith(sourceDir)) score += 2;
      }
      if (edgeKind === "imports" || edgeKind === "depends_on") {
        if (node.kind === "file") score += 6;
        if (/\.(h|hpp|hh|hxx|cpp|cc|cxx)$/.test(node.file_path ?? "")) score += 2;
      } else if (node.kind !== "file") {
        score += 5;
      }
      if (node.qualified_name && !node.qualified_name.includes("::")) score += 1;
      if (node.centrality_score) score += node.centrality_score / 1000;
      return { ...node, score };
    })
    .sort((a, b) => b.score - a.score);
}

function dedupeNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function findSingleNode(db: Database.Database, sql: string, params: unknown[]): GraphNode | null {
  const nodes = db.prepare(sql).all(...params) as GraphNode[];
  return nodes.length === 1 ? nodes[0] : null;
}

function getNodeById(db: Database.Database, id: string): GraphNode | null {
  return (db.prepare(`SELECT * FROM nodes WHERE id = ? LIMIT 1`).get(id) as GraphNode | undefined) ?? null;
}
