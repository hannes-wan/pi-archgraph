import { GraphTraversal } from "../graph/traversal.js";
import { getDb } from "../graph/db.js";
import { getArchgraphDir } from "../util/paths.js";
import { searchSymbols } from "../graph/queries.js";

export async function getImpactForTarget(cwd: string, target: string) {
  const archgraphDir = getArchgraphDir(cwd);
  const db = getDb(archgraphDir);

  try {
    const nodes = searchSymbols(db, target, 5);
    if (nodes.length === 0) {
      return `No symbols found matching: ${target}`;
    }

    const targetNode = nodes[0];
    const traversal = new GraphTraversal(db);
    const callers = traversal.reachable(targetNode.id, 10, "inbound", true);
    const dedupedCallers = dedupeImpactResults(callers, targetNode.id);
    const affectedFiles = new Set<string>();

    let output = `Impact Analysis for: ${targetNode.name}\n`;
    output += `Kind: ${targetNode.kind}\n`;
    output += `Location: ${targetNode.file_path ?? "unknown"}\n\n`;
    output += `Transitive Dependents:\n`;

    dedupedCallers.forEach((caller) => {
      output += `- ${caller.name} [${caller.kind}] via ${caller.via_edge_kind} (distance ${caller.path_length})`;
      if (caller.file_path) {
        output += ` in ${caller.file_path}`;
        affectedFiles.add(caller.file_path);
      }
      output += "\n";
    });

    output += `\nAffected Files:\n`;
    if (affectedFiles.size === 0) {
      output += "- None\n";
    } else {
      Array.from(affectedFiles).sort().forEach((file) => {
        output += `- ${file}\n`;
      });
    }

    output += `\nPriority: high — review the nearest transitive dependents and their owning files before changing the target.\n`;
    output += `Recommendation / Next Step: review the nearest transitive dependents and their owning files before changing the target.\n`;
    output += `Confidence / Uncertainty: moderate confidence from reachable dependents; deeper analysis may reveal indirect runtime effects.\n`;

    return output;
  } finally {
    db.close();
  }
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
