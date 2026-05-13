import { getDb } from "../graph/db.js";
import { getArchgraphDir } from "../util/paths.js";
import { GraphNode } from "../graph/schema.js";
import { GraphTraversal } from "../graph/traversal.js";
import { isArchitectureEdgeKind } from "../graph/semantics.js";
import { searchSymbols, getNodeDependencies, getNodeCallers } from "../graph/queries.js";

export interface SearchResult {
  id: string;
  name: string;
  kind: string;
  qualified_name: string | null;
  file_path: string | null;
  language: string | null;
  score: number;
  match_type: "exact" | "prefix" | "fuzzy";
}

interface CandidateMetrics {
  childCount: number;
  degree: number;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const deduped = new Map<string, SearchResult>();

  for (const result of results) {
    const key = [
      result.kind,
      result.qualified_name ?? result.name,
      result.file_path ?? "",
    ].join("|");
    const existing = deduped.get(key);
    if (!existing || result.score > existing.score) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values());
}

function rankResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aQualified = a.qualified_name?.length ?? 0;
    const bQualified = b.qualified_name?.length ?? 0;
    if (bQualified !== aQualified) return bQualified - aQualified;
    return (a.file_path ?? "").localeCompare(b.file_path ?? "");
  });
}

/**
 * Search the architecture graph.
 */
export async function searchGraph(
  cwd: string,
  query: string,
  kind?: string,
  limit: number = 10,
  file?: string
): Promise<SearchResult[]> {
  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);

  const results: SearchResult[] = [];
  const normalizedQuery = query.trim();
  const lowerQuery = normalizedQuery.toLowerCase();
  const escapedPrefix = `${lowerQuery.replace(/[%_\\]/g, "\\$&")}%`;
  const escapedFuzzy = `%${lowerQuery.replace(/[%_\\]/g, "\\$&")}%`;

  try {
    const buildFileClause = () => file ? "AND file_path LIKE ?" : "";

    // Exact match on qualified_name or name
    let stmt = db.prepare(`
      SELECT * FROM nodes 
      WHERE (qualified_name = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)
      ${kind ? "AND kind = ?" : ""}
      ${buildFileClause()}
      LIMIT ?
    `);

    const exact = kind
      ? (stmt.all(
          normalizedQuery,
          normalizedQuery,
          kind,
          ...(file ? [`%${file}%`] : []),
          limit
        ) as GraphNode[])
      : (stmt.all(
          normalizedQuery,
          normalizedQuery,
          ...(file ? [`%${file}%`] : []),
          limit
        ) as GraphNode[]);

    for (const node of exact) {
      results.push({
        id: node.id,
        name: node.name,
        kind: node.kind as string,
        qualified_name: node.qualified_name || null,
        file_path: node.file_path,
        language: node.language || null,
        score: node.qualified_name?.toLowerCase() === lowerQuery ? 110 : 100,
        match_type: "exact",
      });
    }

    // Prefix match on qualified_name or name
    if (results.length < limit) {
      stmt = db.prepare(`
        SELECT * FROM nodes 
        WHERE (LOWER(qualified_name) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\') 
        ${kind ? "AND kind = ?" : ""}
        ${buildFileClause()}
        ${results.length > 0 ? "AND id NOT IN (" + results.map(() => "?").join(",") + ")" : ""}
        LIMIT ?
      `);

      const prefixParams: unknown[] = [escapedPrefix, escapedPrefix];
      if (kind) prefixParams.push(kind);
      if (file) prefixParams.push(`%${file}%`);
      if (results.length > 0) prefixParams.push(...results.map((r) => r.id));
      prefixParams.push(limit - results.length);

      const prefix = stmt.all(...prefixParams) as GraphNode[];

      for (const node of prefix) {
        results.push({
          id: node.id,
          name: node.name,
          kind: node.kind as string,
          qualified_name: node.qualified_name || null,
          file_path: node.file_path,
          language: node.language || null,
          score: 80,
          match_type: "prefix",
        });
      }
    }

    // Fuzzy match on name
    if (results.length < limit) {
      stmt = db.prepare(`
        SELECT * FROM nodes 
        WHERE (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(qualified_name, '')) LIKE ? ESCAPE '\\')
        ${kind ? "AND kind = ?" : ""}
        ${buildFileClause()}
        ${results.length > 0 ? "AND id NOT IN (" + results.map(() => "?").join(",") + ")" : ""}
        LIMIT ?
      `);

      const fuzzyParams: unknown[] = [escapedFuzzy, escapedFuzzy];
      if (kind) fuzzyParams.push(kind);
      if (file) fuzzyParams.push(`%${file}%`);
      if (results.length > 0) fuzzyParams.push(...results.map((r) => r.id));
      fuzzyParams.push(limit - results.length);

      const fuzzy = stmt.all(...fuzzyParams) as GraphNode[];

      for (const node of fuzzy) {
        results.push({
          id: node.id,
          name: node.name,
          kind: node.kind as string,
          qualified_name: node.qualified_name || null,
          file_path: node.file_path,
          language: node.language || null,
          score: 60,
          match_type: "fuzzy",
        });
      }
    }
  } finally {
    db.close();
  }

  return rankResults(dedupeResults(results)).slice(0, limit);
}

/**
 * Inspect a symbol in the architecture graph.
 * This tool combines searching and context analysis.
 */
export async function inspectSymbol(
  cwd: string,
  query: string,
  options: {
    kind?: string;
    file?: string;
    depth?: number;
    format?: "text" | "mermaid";
    limit?: number;
  } = {}
): Promise<string | { matches: SearchResult[] }> {
  const { kind, file, depth = 2, format = "text", limit = 10 } = options;
  
  // 1. Perform search
  const matches = await searchGraph(cwd, query, kind, limit, file);
  
  if (matches.length === 0) {
    return `No symbols found matching: ${query}`;
  }
  
  // 2. Decide whether to return context or a list
  const exactMatches = matches.filter((match) => match.match_type === "exact");
  const exactMatch = exactMatches.length === 1 ? exactMatches[0] : null;
  const targetMatch = exactMatch || (matches.length === 1 ? matches[0] : null);
  
  if (targetMatch && format !== "text") {
     return getContextResult(cwd, targetMatch, depth, format);
  }

  if (targetMatch && matches.length === 1) {
    return getContextResult(cwd, targetMatch, depth, format);
  }

  if (matches.length > 1) {
    const inferredTarget = await inferBestMatch(cwd, matches);
    if (inferredTarget) {
      const context = await getContextResult(cwd, inferredTarget, depth, format);
      return [
        `Inferred primary definition for '${query}': ${inferredTarget.kind} ${inferredTarget.qualified_name ?? inferredTarget.name} in ${inferredTarget.file_path}`,
        "",
        context,
      ].join("\n");
    }
  }
  
  if (matches.length > 1) {
    return { matches };
  }
  
  return getContextResult(cwd, matches[0], depth, format);
}

export async function inferBestMatch(
  cwd: string,
  matches: SearchResult[]
): Promise<SearchResult | null> {
  const exactMatches = matches.filter((match) => match.match_type === "exact");
  const candidates = exactMatches.length > 0 ? exactMatches : matches;

  if (candidates.length < 2) {
    return candidates[0] ?? null;
  }

  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);

  try {
    const scored = candidates.map((candidate) => {
      const metrics = getCandidateMetrics(db, candidate.id);
      return { candidate, metrics };
    });

    scored.sort((a, b) => {
      if (b.metrics.childCount !== a.metrics.childCount) {
        return b.metrics.childCount - a.metrics.childCount;
      }
      if (b.metrics.degree !== a.metrics.degree) {
        return b.metrics.degree - a.metrics.degree;
      }
      if (b.candidate.score !== a.candidate.score) {
        return b.candidate.score - a.candidate.score;
      }
      return (a.candidate.file_path ?? "").localeCompare(b.candidate.file_path ?? "");
    });

    const [best, next] = scored;
    if (!best) return null;

    const clearlyBetter =
      !next ||
      best.metrics.childCount > next.metrics.childCount ||
      (best.metrics.childCount === next.metrics.childCount && best.metrics.degree >= next.metrics.degree + 2);

    return clearlyBetter ? best.candidate : null;
  } finally {
    db.close();
  }
}

function getCandidateMetrics(db: any, nodeId: string): CandidateMetrics {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN from_id = ? AND kind = 'defines' THEN 1 ELSE 0 END) as childCount,
      SUM(CASE WHEN from_id = ? OR to_id = ? THEN 1 ELSE 0 END) as degree
    FROM edges
    WHERE from_id = ? OR to_id = ?
  `).get(nodeId, nodeId, nodeId, nodeId, nodeId) as { childCount: number | null; degree: number | null } | undefined;

  return {
    childCount: row?.childCount ?? 0,
    degree: row?.degree ?? 0,
  };
}

async function getContextResult(
  cwd: string,
  target: SearchResult,
  depth: number,
  format: "text" | "mermaid"
): Promise<string> {
  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);
  
  try {
    if (format === "mermaid") {
      return await generateMermaidInternal(db, target.id, target.name, depth);
    }

    const traversal = new GraphTraversal(db);
    const deps = getNodeDependencies(db, target.id, depth);
    const callers = getNodeCallers(db, target.id, depth);

    let output = `Symbol: ${target.name} [${target.kind}]\n`;
    if (target.qualified_name) output += `Qualified: ${target.qualified_name}\n`;
    output += `Location: ${target.file_path}\n\n`;
    output += `Fan-in: ${traversal.fanIn(target.id)}\n`;
    output += `Fan-out: ${traversal.fanOut(target.id)}\n`;
    output += `Centrality: ${traversal.centrality(target.id)}\n\n`;

    output += `Dependencies (what it uses):\n`;
    if (deps.length > 0) {
      for (const dep of deps) {
        output += `- ${dep.name} [${dep.kind}] via ${dep.via_edge_kind} (distance ${dep.path_length})`;
        if (dep.file_path) output += ` (${dep.file_path})`;
        output += `\n`;
      }
    } else {
      output += `- None found at depth ${depth}\n`;
    }

    output += `\nCallers (what uses it):\n`;
    if (callers.length > 0) {
      for (const caller of callers) {
        output += `- ${caller.name} [${caller.kind}] via ${caller.via_edge_kind} (distance ${caller.path_length})`;
        if (caller.file_path) output += ` (${caller.file_path})`;
        output += `\n`;
      }
    } else {
      output += `- None found at depth ${depth}\n`;
    }

    output += `\nPriority: high — start with the direct callers; they are the highest-leverage impact surface.\n`;
    output += `Recommendation / Next Step: inspect the direct callers first; they show the highest-leverage impact surface.\n`;
    output += `Confidence / Uncertainty: moderate confidence from graph connectivity; verify with source context when relationships are sparse or ambiguous.\n`;
    
    return output;
  } finally {
    db.close();
  }
}

async function generateMermaidInternal(
  db: any,
  targetId: string,
  targetName: string,
  depth: number
): Promise<string> {
  let output = "graph TD\n";
  const processedEdges = new Set<string>();

  const edges = db.prepare(`
    WITH RECURSIVE neighborhood(from_id, to_id, kind, current_depth) AS (
      SELECT from_id, to_id, kind, 1 FROM edges WHERE from_id = ? OR to_id = ?
      UNION ALL
      SELECT e.from_id, e.to_id, e.kind, n.current_depth + 1
      FROM edges e
      JOIN neighborhood n ON e.from_id = n.to_id OR e.to_id = n.from_id
      WHERE n.current_depth < ?
    )
    SELECT DISTINCT n.from_id, n.to_id, n.kind, n1.name as from_name, n2.name as to_name, n1.kind as from_kind, n2.kind as to_kind
    FROM neighborhood n
    JOIN nodes n1 ON n.from_id = n1.id
    LEFT JOIN nodes n2 ON n.to_id = n2.id
  `).all(targetId, targetId, depth) as any[];

  if (edges.length === 0) {
    return `%% Symbol '${targetName}' found but has no relationships.`;
  }

  const prioritizedEdges = [
    ...edges.filter((edge) => isArchitectureEdgeKind(edge.kind)),
    ...edges.filter((edge) => !isArchitectureEdgeKind(edge.kind)),
  ];

  for (const edge of prioritizedEdges) {
    const edgeKey = `${edge.from_id}->${edge.to_id}:${edge.kind}`;
    if (!processedEdges.has(edgeKey)) {
      const fromLabel = `"${edge.from_name} [${edge.from_kind}]"`;
      const toLabel = edge.to_name ? `"${edge.to_name} [${edge.to_kind}]"` : `"${edge.to_id} [unresolved]"`;
      const cleanFrom = edge.from_id.replace(/[^a-zA-Z0-9]/g, "_");
      const cleanTo = edge.to_id.replace(/[^a-zA-Z0-9]/g, "_");
      output += `  ${cleanFrom}(${fromLabel}) -->|${edge.kind}| ${cleanTo}(${toLabel})\n`;
      processedEdges.add(edgeKey);
    }
  }

  return output;
}
