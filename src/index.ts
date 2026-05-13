/**
 * pi-archgraph: Workspace-level architecture graph extension for Pi
 */

import type { ExtensionAPI, SessionStartEvent, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { registerArchgraphTools } from "./tools/tools.js";
import { sessionStartHook, toolCallHook } from "./tools/hooks.js";
import { isSafeToAutoInit } from "./util/paths.js";

export default function (pi: ExtensionAPI) {
  // Register all archgraph tools
  registerArchgraphTools(pi);

  // 1. session_start hook: Silent auto-initialization
  pi.on("session_start", async (_event: SessionStartEvent, ctx) => {
    const check = await sessionStartHook(ctx.cwd);
    if (check.needsInit) {
      // Safety check: Only auto-init in "real" project directories
      if (!(await isSafeToAutoInit(ctx.cwd))) {
        return;
      }
      if (check.reason.includes("No existing graph") || check.reason.includes("Schema version mismatch")) {
        ctx.ui.notify(`Archgraph: ${check.reason}. Starting background workspace scan...`, "info");

        const { WorkspaceIndexer } = await import("./core/workspace-indexer.js");
        const { setMeta } = await import("./util/meta.js");

        const indexer = new WorkspaceIndexer();
        indexer.updateGraph(ctx.cwd).then(async () => {
          await setMeta(ctx.cwd, {
            indexedAt: Date.now(),
            schemaVersion: 2,
            dirtyFiles: []
          });
          ctx.ui.setStatus("archgraph", "Ready");
          ctx.ui.notify("Archgraph: Project architecture graph is ready.", "info");
        }).catch(err => {
          ctx.ui.setStatus("archgraph", "Error");
          ctx.ui.notify("Archgraph: Background indexing failed.", "error");
          if (process.env.DEBUG) console.error("Auto-init failed:", err);
        });
      }
    } else if (check.state === "ready") {
      ctx.ui.setStatus("archgraph", "Ready");
    }
  });

  // 2. before_agent_start: Inject architecture context and strategy prompt
  // @ts-ignore
  pi.on("before_agent_start", async (event, ctx) => {
    const state = await sessionStartHook(ctx.cwd);
    if (state.state === "missing") return;

    let policy = "";

    if (state.needsInit) {
      policy = `
# Architecture Graph — Initializing
> [!NOTE]
> The architecture graph is currently being built in the background.
> Wait for the "Ready" notification before using archgraph tools.
> In the meantime, you may use standard file tools normally.
`.trim();
    } else {
      const { generateOverview } = await import("./tools/overview.js");
      const overview = await generateOverview(ctx.cwd);
      policy = `
# Architecture Graph — Available

This workspace has a **pre-built architecture graph** that indexes all symbols, dependencies, and file relationships.
Using it is significantly faster and more accurate than manual file exploration for structural questions.

## When to Use Archgraph Tools

| Scenario | Best Tool | Why It's Better |
|----------|-----------|-----------------|
| "What does this project do?" | \`archgraph_overview\` | Returns full topology in one call vs. dozens of \`ls\`/\`read\` |
| "Where is X defined? Who calls it?" | \`archgraph_inspect(query)\` | Finds symbol + callers + dependents instantly vs. \`grep\` chains |
| "What will break if I change X?" | \`archgraph_impact(target)\` | Traces transitive dependents, no manual guessing |
| "I just edited files" | \`archgraph_update\` | Keeps the graph accurate for subsequent queries |

## When to Use Standard File Tools
- Reading file **content** for editing (archgraph indexes structure, not full source).
- Working with non-code files (configs, docs, assets).
- Making targeted edits where you already know the exact file and location.

## Quick Routing (prefer the most specific tool that fits)
- **Broad orientation** ("what is this project?") → \`archgraph_overview\`
- **Concrete symbol / file questions** ("where is X defined?", "who calls Y?") → \`archgraph_inspect(query)\`
- **Pre-change safety / blast-radius** ("what breaks if I change Z?") → \`archgraph_impact(target)\`

## Strategy
1. If you already have a concrete **symbol** or change **target**, start with \`archgraph_inspect\` / \`archgraph_impact\`.
2. Use \`archgraph_overview\` only for broad orientation and initial discovery.
3. **Switch to file tools** for reading/editing specific files identified by archgraph.
4. **Run \`archgraph_update\`** after edits to keep the graph current.

## Tool input examples (copy/paste)

\`archgraph_inspect\` parameters: \`{ query, kind?, file?, depth? (default 2), format? ("text" | "mermaid") }\`

Examples:
- archgraph_inspect({ query: "hashString" })
- archgraph_inspect({ query: "Shape", kind: "trait", file: "src/rust/shapes.rs" })
- archgraph_inspect({ query: "GraphNode", depth: 3, format: "mermaid" })

\`archgraph_impact\` parameters: \`{ target }\`

Examples:
- archgraph_impact({ target: "serializeNodeMetadata" })

---
## Workspace Topology
${overview}
`.trim();
    }

    const dirtySnippet = state.dirtyFiles && state.dirtyFiles.length > 0
      ? `\n\n> [!WARNING]\n> **Architecture Graph Out of Sync**\n> Modified: ${state.dirtyFiles.join(", ")}\n> Run \`archgraph_update()\` to sync.\n`
      : "";

    return { systemPrompt: event.systemPrompt + "\n\n" + policy + dirtySnippet };
  });

  // 3. tool_call hook: Silent dirty tracking
  pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
    await toolCallHook(ctx.cwd, event.toolName, (event as any).input);
  });
}

// Re-export types and utilities for advanced usage
export { updateGraph } from "./core/workspace-indexer.js";
export { inspectSymbol, searchGraph } from "./tools/inspect.js";
export { getImpactForTarget } from "./tools/impact.js";
export { needsSmartInit, getFilesNeedingUpdate, shouldUpdateFile, sessionStartHook, toolCallHook } from "./tools/hooks.js";
export { GraphTraversal } from "./graph/traversal.js";
export { GraphQuery } from "./graph/query.js";
export { GraphAnalyzer } from "./graph/analyzer.js";
export { getEdgeDirectionDescription, EDGE_DIRECTION_SEMANTICS, validateEdgeDirection, validateNodeMetadata } from "./graph/semantics.js";

// Schema types
export type { GraphNode, GraphEdge, GraphFile, GraphRevision, NodeKind, EdgeKind } from "./graph/schema.js";
