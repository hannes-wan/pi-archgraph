# pi-archgraph

> Workspace-level architecture graph for Pi Coding Agent — persistent, multi-language, hash-based incremental indexing.

`pi-archgraph` builds and maintains a queryable architecture graph of your project using SQLite and tree-sitter. It lets the Pi agent understand symbol relationships, dependency propagation, and code topology without reading every file.

---

## Overview

When working in a large or unfamiliar codebase, the agent needs to know **what symbols exist**, **how they relate**, and **what would break if you changed something**. `pi-archgraph` provides this via a persistent graph stored in `.pi/archgraph/graph.db`.

### Core capabilities

| Tool | Purpose |
| :--- | :--- |
| `archgraph_init` | Full or forced rebuild of the architecture graph |
| `archgraph_update` | Incremental sync — reindexes only changed files |
| `archgraph_overview` | High-level project summary: domains, hubs, critical files |
| `archgraph_inspect` | Drill into a symbol: its dependencies, callers, and relationships |
| `archgraph_impact` | Transitive ripple analysis — what breaks if you change X |

### Design goals

- **Project-local**: graph lives at `.pi/archgraph/`, versioned with the project
- **Agent-native**: tools expose `promptSnippet` and `promptGuidelines` for zero-friction context injection
- **Incremental**: hash-based dirty tracking — only modified files are re-parsed
- **Multi-language**: TypeScript, Python, Rust, C, C++ via tree-sitter frontends
- **Auto-initialized**: on session start, silently indexes if the graph is missing

---

## How it works

```
workspace/
  .pi/archgraph/
    graph.db      SQLite — nodes, edges, files, revision metadata
    meta.json      Hashes, indexedAt, dirty file list
```

**Indexing pipeline:**

1. Collect all source files (respects `.gitignore`)
2. Parse with language-specific tree-sitter frontends
3. Extract symbols (functions, classes, interfaces, traits, etc.)
4. Extract edges (calls, imports, extends, implements, etc.)
5. Compute centrality scores (fan-in × 3 + fan-out) and domain clusters
6. Persist to SQLite

**Incremental updates:**

- After write tool calls, `tool_call` hook marks affected files dirty
- `archgraph_update` compares current file hashes vs. stored hashes
- Only files with changed hashes are re-parsed and patched into the graph

---

## Tools reference

### `archgraph_init`

Initialize or rebuild the project graph. Skips if already current.

```
Parameters:
  force?: boolean   // discard existing graph and do full rebuild
```

### `archgraph_update`

Sync the graph after source changes. Resolves targets in priority order: explicit files → dirty files → all tracked files.

```
Parameters:
  files?: string[]   // explicit file paths (optional)
```

### `archgraph_overview`

Returns a high-level topology summary:

- Symbol counts by kind (class, function, method, etc.)
- Language distribution
- Architecture-critical files (high fan-in)
- Core runtime hubs (most-connected symbols)
- Domain clusters and recommended inspection targets

### `archgraph_inspect`

Inspect a symbol and its neighborhood.

```
Parameters:
  query: string       // symbol name
  kind?: string       // filter: class, function, method, etc.
  file?: string       // disambiguate by file path
  depth?: number      // traversal depth (default: 2)
  format?: "text" | "mermaid"  // output format
```

Returns: symbol metadata, fan-in/fan-out, dependency list, caller list, or a Mermaid diagram.

### `archgraph_impact`

Analyze the blast radius of changing a symbol.

```
Parameters:
  target: string   // symbol name to analyze
```

Returns: transitive dependent chain (up to 10 hops) grouped by distance and edge kind.

---

## Architecture

```
src/
  core/
    workspace-indexer.ts     // file collection, parallel parsing, graph patching
  frontends/
    typescript/              // tree-sitter TypeScript
    python/                  // tree-sitter Python
    rust/                    // tree-sitter Rust
    c/                       // tree-sitter C
    cpp/                     // tree-sitter C++
    frontend.ts              // LanguageFrontend interface
    registry.ts              // frontend lookup by file extension
  graph/
    schema.ts                // SQLite DDL, TypeScript types for Node/Edge/File
    traversal.ts             // fan-in/out, shortest path, recursive reachability
    analyzer.ts              // centrality ranking, domain clustering, file topology
    queries.ts               // dependency/caller queries
    semantics.ts            // edge kind semantics, validation, architecture filters
    domains.ts              // domain/subsystem inference from file paths
    db.ts                    // database lifecycle (open, close, WAL mode)
    patch.ts                 // atomic INSERT/DELETE batching
    metadata.ts              // graph revision tracking
  tools/
    tools.ts                 // tool registration (archgraph_* namespace)
    inspect.ts               // symbol search + context assembly
    impact.ts                // transitive dependent analysis
    overview.ts              // architecture summary generator
    hooks.ts                 // session_start + tool_call hooks, dirty tracking
  util/
    hashing.ts               // xxhash for file and string hashing
    paths.ts                 // .pi/archgraph directory resolution
    meta.ts                  // meta.json read/write
```

### Schema

```sql
nodes(id, kind, name, language, qualified_name, file_path,
      start_line, end_line, hash, summary, metadata_json,
      domain, subsystem, cluster_id, centrality_score)

edges(id, from_id, to_id, kind, confidence, metadata_json,
      source_file, source_start_line, source_end_line)

files(path, hash, mtime, language, last_indexed_at,
      symbol_count, edge_count, domain, subsystem, centrality_score)

graph_metadata(key, value)
```

### Edge kinds

| Kind | Direction | Meaning |
| :--- | :--- | :--- |
| `calls` | caller → callee | function invocation |
| `imports` | importer → imported | module/namespace import |
| `extends` | child → parent | class inheritance |
| `implements` | impl → interface | interface implementation |
| `depends_on` | dependent → dependency | semantic dependency |
| `references` | referrer → referenced | general reference |
| `contains` / `defines` | container → child | structural containment |

---

## Development

```bash
npm install
npm run test:run        # run all tests once
npm run test:coverage   # with coverage report
```

### Writing a new language frontend

Implement `LanguageFrontend`:

```typescript
interface LanguageFrontend {
  language: string;
  supports(path: string): boolean;
  parseFile(path: string, content: string): Promise<GraphPatch>;
}
```

Register it in `src/frontends/index.ts` via `FrontendRegistry.register(new YourFrontend())`.

---

## License

MIT
