import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getImpactForTarget } from "./impact.js";
import {
  needsSmartInit,
  getFilesNeedingUpdate,
  clearDirtyAfterUpdate,
  resolveUpdateTargets,
} from "./hooks.js";
import { inspectSymbol } from "./inspect.js";
import { setMeta } from "../util/meta.js";
import { generateOverview } from "./overview.js";

const SCHEMA_VERSION = 2;

export function registerArchgraphTools(pi: ExtensionAPI): void {
  // ---------------------------------------------------------------------------
  // archgraph_init
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "archgraph_init",
    label: "Initialize Architecture Graph",
    description: "Initialize or rebuild the project architecture graph.",
    promptSnippet:
      "Run archgraph_init once before using archgraph tools in a new or broken project.",
    promptGuidelines: [
      "Use archgraph_init only when the graph is missing, schema-incompatible, corrupted, or explicitly needs a full rebuild.",
      "Prefer archgraph_update over archgraph_init after normal source file edits.",
    ],

    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({
          description:
            "If true, discard existing graph data and perform a full clean rebuild.",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;

      // -----------------------------------------------------------------------
      // smart state check
      // -----------------------------------------------------------------------

      if (!params.force) {
        const check = await needsSmartInit(cwd, SCHEMA_VERSION);

        // graph already usable
        if (!check.needsInit && !check.needsUpdate) {
          return {
            content: [
              {
                type: "text",
                text: `Graph already up-to-date (indexed: ${check.indexedAt
                    ? new Date(check.indexedAt).toISOString()
                    : "never"
                  }). Use force=true to rebuild.`,
              },
            ],

            details: {
              skipped: true,
              state: check.state,
              reason: check.reason,
            },
          };
        }

        // graph dirty -> update instead
        if (!check.needsInit && check.needsUpdate) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Graph exists but requires incremental update.\n\n` +
                  `Reason: ${check.reason}\n\n` +
                  `Run archgraph_update instead of archgraph_init.`,
              },
            ],

            details: {
              skipped: true,
              needsUpdate: true,
              state: check.state,
              dirtyFiles: check.dirtyFiles ?? [],
              reason: check.reason,
            },
          };
        }

        // missing / corrupted / schema mismatch
        onUpdate?.({
          content: [
            {
              type: "text",
              text:
                `Graph initialization required.\n\n` +
                `State: ${check.state}\n` +
                `Reason: ${check.reason}`,
            },
          ],

          details: {
            state: check.state,
          },
        });
      }

      // -----------------------------------------------------------------------
      // load indexer lazily
      // -----------------------------------------------------------------------

      const { WorkspaceIndexer } = await import(
        "../core/workspace-indexer.js"
      );

      const indexer = new WorkspaceIndexer();

      onUpdate?.({
        content: [
          {
            type: "text",
            text: "Starting architecture graph initialization...",
          },
        ],

        details: {},
      });

      // -----------------------------------------------------------------------
      // full rebuild
      // -----------------------------------------------------------------------

      await indexer.updateGraph(cwd, [], (current, total) => {
        if (signal?.aborted) {
          throw new Error("archgraph_init aborted");
        }

        if (
          current === 1 ||
          current === total ||
          current % 10 === 0
        ) {
          onUpdate?.({
            content: [
              {
                type: "text",
                text: `Indexing progress: ${current}/${total} files processed...`,
              },
            ],

            details: {
              current,
              total,
              progress:
                total > 0
                  ? Math.round((current / total) * 100)
                  : 0,
            },
          });
        }
      });

      // -----------------------------------------------------------------------
      // persist metadata
      // -----------------------------------------------------------------------

      const indexedAt = Date.now();

      await setMeta(cwd, {
        indexedAt,
        schemaVersion: SCHEMA_VERSION,
        dirtyFiles: [],
        lastUpdateReason: null,
      });

      return {
        content: [
          {
            type: "text",
            text:
              "Architecture graph initialized successfully.\n\n" +
              "The workspace graph is now ready for:\n" +
              "- symbol inspection\n" +
              "- architecture overview\n" +
              "- dependency analysis\n" +
              "- impact analysis\n" +
              "- child agent context injection",
          },
        ],

        details: {
          initialized: true,
          force: params.force ?? false,
          schemaVersion: SCHEMA_VERSION,
          indexedAt,
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // archgraph_update
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "archgraph_update",
    label: "Update Architecture Graph",
    description: "Sync the architecture graph after source files changed.",

    promptSnippet:
      "Run archgraph_update after editing files before relying on architecture graph results.",

    promptGuidelines: [
      "Use archgraph_update after modifying source files.",
      "Call archgraph_update with no files when unsure what changed.",
      "Use archgraph_update before archgraph_inspect or archgraph_impact if the user asks about architecture after recent edits.",
    ],

    parameters: Type.Object({
      files: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional file paths to update. If omitted, dirty or tracked files are auto-detected.",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;

      const resolution = await resolveUpdateTargets(
        cwd,
        params.files,
      );

      const candidateFiles = resolution.files;

      // -----------------------------------------------------------------------
      // nothing to update
      // -----------------------------------------------------------------------

      if (candidateFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "No dirty or tracked files available for graph update. Initialize the graph first if needed.",
            },
          ],

          details: {
            updated: 0,
            source: resolution.source,
            skipped: true,
          },
        };
      }

      // -----------------------------------------------------------------------
      // determine changed files
      // -----------------------------------------------------------------------

      const changedFiles = await getFilesNeedingUpdate(
        cwd,
        candidateFiles,
      );

      // -----------------------------------------------------------------------
      // already synchronized
      // -----------------------------------------------------------------------

      if (changedFiles.length === 0) {
        await clearDirtyAfterUpdate(cwd, candidateFiles);

        await setMeta(cwd, {
          indexedAt: Date.now(),
          lastUpdateReason: null,
        });

        return {
          content: [
            {
              type: "text",
              text:
                `No changes detected across ${candidateFiles.length} ` +
                `${resolution.source} files. Graph sync is already current.`,
            },
          ],

          details: {
            updated: 0,
            checked: candidateFiles.length,
            source: resolution.source,
            skipped: true,
          },
        };
      }

      // -----------------------------------------------------------------------
      // run incremental update
      // -----------------------------------------------------------------------

      const { WorkspaceIndexer } = await import(
        "../core/workspace-indexer.js"
      );

      const indexer = new WorkspaceIndexer();

      await indexer.updateGraph(
        cwd,
        changedFiles,
        (current, total) => {
          if (signal?.aborted) {
            throw new Error("archgraph_update aborted");
          }

          onUpdate?.({
            content: [
              {
                type: "text",
                text: `Updating progress: ${current}/${total} files...`,
              },
            ],

            details: {
              current,
              total,
              progress:
                total > 0
                  ? Math.round((current / total) * 100)
                  : 0,
            },
          });
        },
      );

      // -----------------------------------------------------------------------
      // clear dirty state
      // -----------------------------------------------------------------------

      await clearDirtyAfterUpdate(cwd, changedFiles);

      const indexedAt = Date.now();

      await setMeta(cwd, {
        indexedAt,
        lastUpdateReason: null,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Updated ${changedFiles.length} of ` +
              `${candidateFiles.length} ${resolution.source} files in graph.`,
          },
        ],

        details: {
          updated: changedFiles.length,
          checked: candidateFiles.length,
          source: resolution.source,
          indexedAt,
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // archgraph_inspect
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "archgraph_inspect",
    label: "Inspect Symbol",
    description:
      "Instantly find where a symbol is defined, who calls it, what it depends on, and which files are related — " +
      "all in a single call. This replaces multi-step grep → read → grep chains with one indexed lookup. " +
      "Returns callers, callees, dependencies, and file ownership." +
      "\n\n" +
      "Args: { query, kind?, file?, depth?, format? } (query required)\n" +
      "Example: archgraph_inspect({ query: \"hashString\" })",

    promptSnippet:
      "Use archgraph_inspect instead of grep chains when investigating a symbol's definition, callers, or dependencies.\n\n" +
      "Args: { query, kind?, file?, depth?, format? } (query required)\n" +
      "Example: archgraph_inspect({ query: \"hashString\" })",
    promptGuidelines: [
      "Prefer archgraph_inspect over grep/find for 'where is X?', 'who uses X?', 'what does X depend on?' questions.",
      "If multiple matches are returned, retry with kind or file to disambiguate.",
      "Use format='mermaid' when the user would benefit from a visual dependency diagram.",
      "After inspecting a symbol, use read to view the specific file/lines identified — archgraph finds, you read.",
    ],

    parameters: Type.Object({
      query: Type.String({
        description: "Symbol name to inspect.",
      }),

      kind: Type.Optional(
        Type.String({
          description:
            "Optional node kind filter, such as class, function, or method.",
        }),
      ),

      file: Type.Optional(
        Type.String({
          description:
            "Optional file path hint to disambiguate symbols with the same name.",
        }),
      ),

      depth: Type.Optional(
        Type.Number({
          description:
            "Relationship traversal depth. Default is 2.",
          default: 2,
        }),
      ),

      format: Type.Optional(
        Type.Union([
          Type.Literal("text"),
          Type.Literal("mermaid"),
        ], {
          description:
            "Output format. Use mermaid for diagrams.",
          default: "text",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await inspectSymbol(
        ctx.cwd,
        params.query,
        {
          kind: params.kind,
          file: params.file,
          depth: params.depth,
          format: params.format as any,
        },
      );

      // -----------------------------------------------------------------------
      // ambiguous symbol
      // -----------------------------------------------------------------------

      if (
        result &&
        typeof result === "object" &&
        "matches" in result
      ) {
        const text = result.matches
          .map(
            (r) =>
              `[${r.match_type}] ${r.kind}: ${r.name}${r.qualified_name
                ? ` (${r.qualified_name})`
                : ""
              } in ${r.file_path}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text:
                `Multiple matches found for '${params.query}':\n\n` +
                `${text}\n\n` +
                `Retry with 'kind' or 'file' to disambiguate.`,
            },
          ],

          details: {
            matches: result.matches.length,
          },
        };
      }

      // -----------------------------------------------------------------------
      // mermaid diagram
      // -----------------------------------------------------------------------

      if (params.format === "mermaid") {
        return {
          content: [
            {
              type: "text",
              text:
                `### Architecture Diagram for '${params.query}'\n\n` +
                "```mermaid\n" +
                result +
                "\n```",
            },
          ],

          details: {
            query: params.query,
            format: "mermaid",
          },
        };
      }

      // -----------------------------------------------------------------------
      // normal text result
      // -----------------------------------------------------------------------

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],

        details: {
          query: params.query,
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // archgraph_impact
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "archgraph_impact",

    label: "Get Impact Analysis",
    description:
      "Before changing a function, class, or API — find out what will break. " +
      "Traces all transitive dependents, affected files, and propagation paths through the architecture graph. " +
      "This prevents accidental regressions by revealing the full blast radius before you edit." +
      "\n\n" +
      "Args: { target } (target required)\n" +
      "Example: archgraph_impact({ target: \"serializeNodeMetadata\" })",

    promptSnippet:
      "Run archgraph_impact before modifying shared APIs or central symbols to prevent accidental regressions.\n\n" +
      "Args: { target } (target required)\n" +
      "Example: archgraph_impact({ target: \"serializeNodeMetadata\" })",
    promptGuidelines: [
      "Use archgraph_impact before editing any function/class that might be used by other files.",
      "Use archgraph_inspect first if the target symbol is ambiguous.",
      "If impact shows many dependents, plan a careful, incremental migration rather than a big-bang change.",
    ],
    parameters: Type.Object({
      target: Type.String({
        description:
          "Symbol name to analyze for change impact.",
      }),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await getImpactForTarget(
        ctx.cwd,
        params.target,
      );

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],

        details: {
          target: params.target,
        },
      };
    },
  });

  // ---------------------------------------------------------------------------
  // archgraph_overview
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "archgraph_overview",

    label: "Project Overview",
    description:
      "Get the entire project's architecture topology in one call — dependency hubs, critical files, domain clusters, " +
      "and key symbols. This replaces the 'ls → read README → ls src → read files' exploration loop " +
      "with a single, comprehensive structural summary. Best for initial orientation and broad discovery.",
    promptSnippet:
      "Use archgraph_overview for initial orientation (e.g. 'what does this project do?' / 'how is it structured?').",
    promptGuidelines: [
      "Use archgraph_overview for initial orientation in unfamiliar or large projects.",
      "After overview identifies key symbols or hubs, use archgraph_inspect to drill into specific ones.",
      "Before changing a symbol, use archgraph_impact to understand what will break.",
      "Don't ls/read around trying to understand structure — archgraph_overview already has the full map.",
    ],
    parameters: Type.Object({}),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const overview = await generateOverview(ctx.cwd);

      return {
        content: [
          {
            type: "text",
            text: overview,
          },
        ],

        details: {},
      };
    },
  });
}
