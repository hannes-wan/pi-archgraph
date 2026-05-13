import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../../src/graph/db.js";
import { patchGraph } from "../../../src/graph/patch.js";
import { getImpactForTarget } from "../../../src/tools/impact.js";

describe("impact tool ambiguity handling", () => {
  const tempDir = fs.mkdtempSync(path.join("/tmp", "archgraph-impact-ambiguity-"));
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

  it("prefers the richer class match over a same-name function", async () => {
    patchGraph(
      db,
      [
        { path: "/src/RtmpMessage.h", hash: "h1", mtime: 1, language: "cpp", last_indexed_at: 1 },
        { path: "/src/Parser.cpp", hash: "h2", mtime: 1, language: "cpp", last_indexed_at: 1 },
      ],
      [
        {
          id: "class:/src/RtmpMessage.h:RtmpMessage",
          language: "cpp",
          kind: "class",
          name: "RtmpMessage",
          qualified_name: "RtmpMessage",
          file_path: "/src/RtmpMessage.h",
          start_line: 1,
          end_line: 40,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: "function:/src/RtmpMessage.h:RtmpMessage",
          language: "cpp",
          kind: "function",
          name: "RtmpMessage",
          qualified_name: "RtmpMessage",
          file_path: "/src/RtmpMessage.h",
          start_line: 42,
          end_line: 45,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: "method:/src/RtmpMessage.h:RtmpMessage::decode",
          language: "cpp",
          kind: "method",
          name: "decode",
          qualified_name: "RtmpMessage::decode",
          file_path: "/src/RtmpMessage.h",
          start_line: 5,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: "method:/src/RtmpMessage.h:RtmpMessage::encode",
          language: "cpp",
          kind: "method",
          name: "encode",
          qualified_name: "RtmpMessage::encode",
          file_path: "/src/RtmpMessage.h",
          start_line: 12,
          end_line: 20,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: "function:/src/Parser.cpp:parseMessage",
          language: "cpp",
          kind: "function",
          name: "parseMessage",
          qualified_name: "parseMessage",
          file_path: "/src/Parser.cpp",
          start_line: 1,
          end_line: 20,
          hash: null,
          summary: null,
          metadata_json: null,
        },
      ],
      [
        {
          id: "def:1",
          from_id: "class:/src/RtmpMessage.h:RtmpMessage",
          to_id: "method:/src/RtmpMessage.h:RtmpMessage::decode",
          kind: "defines",
          confidence: 1,
          metadata_json: null,
          source_file: "/src/RtmpMessage.h",
          source_start_line: 5,
          source_end_line: 10,
        },
        {
          id: "def:2",
          from_id: "class:/src/RtmpMessage.h:RtmpMessage",
          to_id: "method:/src/RtmpMessage.h:RtmpMessage::encode",
          kind: "defines",
          confidence: 1,
          metadata_json: null,
          source_file: "/src/RtmpMessage.h",
          source_start_line: 12,
          source_end_line: 20,
        },
        {
          id: "ref:1",
          from_id: "function:/src/Parser.cpp:parseMessage",
          to_id: "class:/src/RtmpMessage.h:RtmpMessage",
          kind: "references",
          confidence: 1,
          metadata_json: null,
          source_file: "/src/Parser.cpp",
          source_start_line: 2,
          source_end_line: 2,
        },
      ],
    );

    const output = await getImpactForTarget(tempDir, "RtmpMessage");

    expect(output).toContain("Inferred primary definition for 'RtmpMessage': class RtmpMessage");
    expect(output).toContain("Impact Analysis for: RtmpMessage");
    expect(output).toContain("Kind: class");
    expect(output).toContain("parseMessage [function]");
  });
});
