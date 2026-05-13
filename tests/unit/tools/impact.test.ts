import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../../src/graph/db.js";
import { patchGraph } from "../../../src/graph/patch.js";
import { getImpactForTarget } from "../../../src/tools/impact.js";

describe("impact tool", () => {
  const tempDir = fs.mkdtempSync(path.join("/tmp", "archgraph-impact-"));
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

  it("dedupes repeated transitive dependents and excludes self cycles", async () => {
    patchGraph(
      db,
      [],
      [
        {
          id: "class:/SessionCoordinator.h:SessionCoordinator",
          language: "cpp",
          kind: "class",
          name: "SessionCoordinator",
          qualified_name: "SessionCoordinator",
          file_path: "/SessionCoordinator.h",
          start_line: 1,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: "class:/MainWindow.h:MainWindow",
          language: "cpp",
          kind: "class",
          name: "MainWindow",
          qualified_name: "MainWindow",
          file_path: "/MainWindow.h",
          start_line: 1,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
      ],
      [
        {
          id: "ref:1",
          from_id: "class:/MainWindow.h:MainWindow",
          to_id: "class:/SessionCoordinator.h:SessionCoordinator",
          kind: "references",
          confidence: 1,
          metadata_json: null,
          source_file: "/MainWindow.h",
          source_start_line: 1,
          source_end_line: 1,
        },
        {
          id: "ref:2",
          from_id: "class:/MainWindow.h:MainWindow",
          to_id: "class:/SessionCoordinator.h:SessionCoordinator",
          kind: "depends_on",
          confidence: 1,
          metadata_json: null,
          source_file: "/MainWindow.h",
          source_start_line: 2,
          source_end_line: 2,
        },
        {
          id: "cycle:1",
          from_id: "class:/SessionCoordinator.h:SessionCoordinator",
          to_id: "class:/SessionCoordinator.h:SessionCoordinator",
          kind: "references",
          confidence: 1,
          metadata_json: null,
          source_file: "/SessionCoordinator.h",
          source_start_line: 1,
          source_end_line: 1,
        },
      ],
    );

    const output = await getImpactForTarget(tempDir, "SessionCoordinator");

    expect(output).toContain("MainWindow [class] via depends_on, references");
    expect(output.match(/MainWindow \[class\] via depends_on, references/g)?.length).toBe(1);
    expect(output).not.toContain("SessionCoordinator [class] via references");

  });
});
