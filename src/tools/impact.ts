import { GraphTraversal } from "../graph/traversal.js";
import { getDb } from "../graph/db.js";
import { getArchgraphDir } from "../util/paths.js";
import { inferBestMatch, searchGraph, SearchResult } from "./inspect.js";

export async function getImpactForTarget(cwd: string, target: string) {
  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);

  try {
    const matches = await searchGraph(cwd, target, undefined, 10);
    if (matches.length === 0) {
      return `No symbols found matching: ${target}`;
    }

    const exactMatches = matches.filter((match) => match.match_type === "exact");
    const uniqueExact = exactMatches.length === 1 ? exactMatches[0] : null;
    const inferredMatch = uniqueExact ?? (matches.length === 1 ? matches[0] : await inferBestMatch(cwd, matches));

    if (!inferredMatch) {
      return formatAmbiguousTarget(target, matches);
    }

    const targetNode = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(inferredMatch.id) as any;
    const traversal = new GraphTraversal(db);
    const callers = traversal.reachable(targetNode.id, 10, "inbound", true);
    const dedupedCallers = dedupeImpactResults(callers, targetNode.id);
    const affectedFiles = new Set<string>();

    let output = "";
    if (matches.length > 1) {
      output += `Inferred primary definition for '${target}': ${inferredMatch.kind} ${inferredMatch.qualified_name ?? inferredMatch.name} in ${inferredMatch.file_path}\n\n`;
    }

    let outputBody = `Impact Analysis for: ${targetNode.name}\n`;
    outputBody += `Kind: ${targetNode.kind}\n`;
    outputBody += `Location: ${targetNode.file_path ?? "unknown"}\n\n`;
    outputBody += `Transitive Dependents:\n`;

    dedupedCallers.forEach((caller) => {
      outputBody += `- ${caller.name} [${caller.kind}] via ${caller.via_edge_kind} (distance ${caller.path_length})`;
      if (caller.file_path) {
        outputBody += ` in ${caller.file_path}`;
        affectedFiles.add(caller.file_path);
      }
      outputBody += "\n";
    });

    outputBody += `\nAffected Files:\n`;
    if (affectedFiles.size === 0) {
      outputBody += "- None\n";
    } else {
      Array.from(affectedFiles).sort().forEach((file) => {
        outputBody += `- ${file}\n`;
      });
    }

    outputBody += `\nPriority: high — review the nearest transitive dependents and their owning files before changing the target.\n`;
    outputBody += `Recommendation / Next Step: review the nearest transitive dependents and their owning files before changing the target.\n`;
    outputBody += `Confidence / Uncertainty: moderate confidence from reachable dependents; deeper analysis may reveal indirect runtime effects.\n`;

    return output + outputBody;
  } finally {
    db.close();
  }
}

function formatAmbiguousTarget(target: string, matches: SearchResult[]): string {
  const lines = matches.slice(0, 5).map((match) =>
    `- ${match.name} [${match.kind}] (${match.match_type})${match.file_path ? ` in ${match.file_path}` : ""}`
  );

  return [
    `Ambiguous target: ${target}`,
    "Provide 'kind' or 'file' to disambiguate. Top matches:",
    ...lines,
  ].join("\n");
}

function dedupeImpactResults<T extends { id: string; path_length: number; via_edge_kind: string }>(
  callers: T[],
  targetId: string
): T[] {
  const bestByKey = new Map<string, T>();

  for (const caller of callers) {
    if (caller.id === targetId) continue;
    const key = `${caller.id}:${caller.via_edge_kind}`;
    const existing = bestByKey.get(key);
    if (!existing || caller.path_length < existing.path_length) {
      bestByKey.set(key, caller);
    }
  }

  return [...bestByKey.values()].sort((a, b) => {
    if (a.path_length !== b.path_length) return a.path_length - b.path_length;
    if (a.via_edge_kind !== b.via_edge_kind) return a.via_edge_kind.localeCompare(b.via_edge_kind);
    return a.id.localeCompare(b.id);
  });
}
