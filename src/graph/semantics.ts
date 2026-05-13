import { EdgeKind, GraphEdge, GraphNodeMetadata, NodeKind } from "./schema.js";

export const EDGE_DIRECTION_SEMANTICS: Record<string, string> = {
  calls: "caller -> callee",
  imports: "importer -> imported",
  references: "referrer -> referenced",
  extends: "child -> parent",
  implements: "implementation -> interface",
  contains: "container -> child",
  defines: "definer -> defined",
  owns: "owner -> owned",
  spawns: "parent -> child",
  waits_for: "waiter -> awaited",
  depends_on: "dependent -> dependency",
  reads: "reader -> resource",
  writes: "writer -> resource",
  handles: "handler -> message_or_request",
  routes_to: "router -> destination",
  publishes: "publisher -> topic_or_message",
  subscribes: "subscriber -> topic_or_message",
  sends_message_to: "sender -> recipient",
};

export const ARCHITECTURE_RELEVANT_EDGE_KINDS = new Set<EdgeKind | string>([
  "calls",
  "imports",
  "depends_on",
  "references",
  "reads",
  "writes",
  "extends",
  "implements",
  "handles",
  "routes_to",
  "publishes",
  "subscribes",
  "spawns",
  "waits_for",
  "owns",
  "sends_message_to",
]);

export const RECOMMENDABLE_NODE_KINDS = new Set<NodeKind | string>([
  "class",
  "function",
  "method",
  "module",
  "trait",
  "service",
  "tool",
  "flow",
  "process",
]);

export function getEdgeDirectionDescription(kind: EdgeKind | string): string {
  return EDGE_DIRECTION_SEMANTICS[kind] ?? "source -> target";
}

export function isArchitectureEdgeKind(kind: EdgeKind | string): boolean {
  return ARCHITECTURE_RELEVANT_EDGE_KINDS.has(kind);
}

export function validateEdgeDirection(edge: GraphEdge): void {
  if (!edge.from_id || !edge.to_id) {
    throw new Error(`Invalid edge '${edge.id}': missing from_id/to_id`);
  }
}

export function validateNodeMetadata(kind: NodeKind | string, metadata: GraphNodeMetadata | null): void {
  if (!metadata) return;

  const record = metadata as Record<string, unknown>;
  if (kind === "function" || kind === "method") {
    if ("async" in record && typeof record.async !== "boolean") {
      throw new Error(`Invalid function metadata: async must be boolean`);
    }
    if ("exported" in record && typeof record.exported !== "boolean") {
      throw new Error(`Invalid function metadata: exported must be boolean`);
    }
  }

  if (kind === "class") {
    if ("abstract" in record && typeof record.abstract !== "boolean") {
      throw new Error(`Invalid class metadata: abstract must be boolean`);
    }
  }

  if (kind === "topic") {
    if ("retain" in record && typeof record.retain !== "boolean") {
      throw new Error(`Invalid topic metadata: retain must be boolean`);
    }
    if ("qos" in record && typeof record.qos !== "number") {
      throw new Error(`Invalid topic metadata: qos must be number`);
    }
  }
}

export function serializeNodeMetadata(kind: NodeKind | string, metadata: GraphNodeMetadata | null): string | null {
  validateNodeMetadata(kind, metadata);
  return metadata ? JSON.stringify(metadata) : null;
}
