import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../../src/graph/db.js";
import { patchGraph } from "../../../src/graph/patch.js";
import { generateOverviewData } from "../../../src/tools/overview.js";

describe("overview ranking", () => {
  const tempDir = fs.mkdtempSync(path.join("/tmp", "archgraph-overview-ranking-"));
  const archgraphDir = path.join(tempDir, ".pi", "archgraph");
  let db: ReturnType<typeof getDb>;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("deprioritizes third-party hubs in recommendations", async () => {
    patchGraph(
      db,
      [
        { path: "/workspace/src/app.cpp", hash: "a1", mtime: 1, language: "cpp", last_indexed_at: 1 },
        { path: "/workspace/src/parser.cpp", hash: "a2", mtime: 1, language: "cpp", last_indexed_at: 1 },
        { path: "/workspace/src/thirdparty/json.hpp", hash: "a3", mtime: 1, language: "cpp", last_indexed_at: 1 },
        { path: "/workspace/src/thirdparty/adapter.cpp", hash: "a4", mtime: 1, language: "cpp", last_indexed_at: 1 },
      ],
      [
        { id: "class:/workspace/src/app.cpp:SessionManager", language: "cpp", kind: "class", name: "SessionManager", qualified_name: "SessionManager", file_path: "/workspace/src/app.cpp", start_line: 1, end_line: 30, hash: null, summary: null, metadata_json: null },
        { id: "method:/workspace/src/app.cpp:SessionManager::start", language: "cpp", kind: "method", name: "start", qualified_name: "SessionManager::start", file_path: "/workspace/src/app.cpp", start_line: 2, end_line: 5, hash: null, summary: null, metadata_json: null },
        { id: "method:/workspace/src/app.cpp:SessionManager::stop", language: "cpp", kind: "method", name: "stop", qualified_name: "SessionManager::stop", file_path: "/workspace/src/app.cpp", start_line: 6, end_line: 9, hash: null, summary: null, metadata_json: null },
        { id: "class:/workspace/src/thirdparty/json.hpp:JsonValue", language: "cpp", kind: "class", name: "JsonValue", qualified_name: "JsonValue", file_path: "/workspace/src/thirdparty/json.hpp", start_line: 1, end_line: 120, hash: null, summary: null, metadata_json: null },
        { id: "function:/workspace/src/parser.cpp:parse", language: "cpp", kind: "function", name: "parse", qualified_name: "parse", file_path: "/workspace/src/parser.cpp", start_line: 1, end_line: 20, hash: null, summary: null, metadata_json: null },
        { id: "function:/workspace/src/thirdparty/adapter.cpp:convert", language: "cpp", kind: "function", name: "convert", qualified_name: "convert", file_path: "/workspace/src/thirdparty/adapter.cpp", start_line: 1, end_line: 20, hash: null, summary: null, metadata_json: null }
      ],
      [
        { id: "d1", from_id: "class:/workspace/src/app.cpp:SessionManager", to_id: "method:/workspace/src/app.cpp:SessionManager::start", kind: "defines", confidence: 1, metadata_json: null, source_file: "/workspace/src/app.cpp", source_start_line: 2, source_end_line: 5 },
        { id: "d2", from_id: "class:/workspace/src/app.cpp:SessionManager", to_id: "method:/workspace/src/app.cpp:SessionManager::stop", kind: "defines", confidence: 1, metadata_json: null, source_file: "/workspace/src/app.cpp", source_start_line: 6, source_end_line: 9 },
        { id: "e1", from_id: "function:/workspace/src/parser.cpp:parse", to_id: "class:/workspace/src/app.cpp:SessionManager", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/parser.cpp", source_start_line: 2, source_end_line: 2 },
        { id: "e2", from_id: "function:/workspace/src/parser.cpp:parse", to_id: "class:/workspace/src/thirdparty/json.hpp:JsonValue", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/parser.cpp", source_start_line: 3, source_end_line: 3 },
        { id: "e3", from_id: "function:/workspace/src/thirdparty/adapter.cpp:convert", to_id: "class:/workspace/src/thirdparty/json.hpp:JsonValue", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/thirdparty/adapter.cpp", source_start_line: 4, source_end_line: 4 },
        { id: "e4", from_id: "class:/workspace/src/thirdparty/json.hpp:JsonValue", to_id: "function:/workspace/src/thirdparty/adapter.cpp:convert", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/thirdparty/json.hpp", source_start_line: 10, source_end_line: 10 },
        { id: "e5", from_id: "class:/workspace/src/thirdparty/json.hpp:JsonValue", to_id: "function:/workspace/src/parser.cpp:parse", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/thirdparty/json.hpp", source_start_line: 11, source_end_line: 11 }
      ],
    );

    const result = await generateOverviewData(tempDir);

    expect(result.recommendations[0]?.filePath).not.toContain("/thirdparty/");
    expect(result.recommendations.some((item) => item.filePath?.includes("/thirdparty/"))).toBe(false);
    expect(result.overview).not.toContain("`/workspace/src/thirdparty/json.hpp`");
    expect(result.overview).toContain("Recommended Next Inspections");
    expect(result.overview).toContain("SessionManager");
  });

  it("still surfaces workspace recommendations when third-party nodes dominate the top hubs", async () => {
    const files = [{ path: "/workspace/src/app.cpp", hash: "root", mtime: 1, language: "cpp", last_indexed_at: 1 }];
    const nodes = [
      { id: "class:/workspace/src/app.cpp:SessionManager", language: "cpp", kind: "class", name: "SessionManager", qualified_name: "SessionManager", file_path: "/workspace/src/app.cpp", start_line: 1, end_line: 30, hash: null, summary: null, metadata_json: null },
      { id: "function:/workspace/src/app.cpp:run", language: "cpp", kind: "function", name: "run", qualified_name: "run", file_path: "/workspace/src/app.cpp", start_line: 31, end_line: 40, hash: null, summary: null, metadata_json: null },
    ] as any[];
    const edges = [
      { id: "app-edge", from_id: "function:/workspace/src/app.cpp:run", to_id: "class:/workspace/src/app.cpp:SessionManager", kind: "references", confidence: 1, metadata_json: null, source_file: "/workspace/src/app.cpp", source_start_line: 32, source_end_line: 32 },
    ] as any[];

    for (let i = 0; i < 12; i++) {
      const filePath = `/workspace/src/thirdparty/lib${i}.hpp`;
      files.push({ path: filePath, hash: `t${i}`, mtime: 1, language: "cpp", last_indexed_at: 1 });
      nodes.push({ id: `class:${filePath}:Vendor${i}`, language: "cpp", kind: "class", name: `Vendor${i}`, qualified_name: `Vendor${i}`, file_path: filePath, start_line: 1, end_line: 20, hash: null, summary: null, metadata_json: null });
      if (i > 0) {
        edges.push({ id: `vendor-edge-${i}`, from_id: `class:${filePath}:Vendor${i}`, to_id: `class:/workspace/src/thirdparty/lib0.hpp:Vendor0`, kind: "references", confidence: 1, metadata_json: null, source_file: filePath, source_start_line: 2, source_end_line: 2 });
      }
    }

    patchGraph(db, files, nodes, edges);

    const result = await generateOverviewData(tempDir);

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]?.name).toBe("SessionManager");
  });
});
