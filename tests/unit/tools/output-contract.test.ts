import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../../src/graph/db.js";
import { patchGraph } from "../../../src/graph/patch.js";
import { inspectSymbol } from "../../../src/tools/inspect.js";
import { getImpactForTarget } from "../../../src/tools/impact.js";
import { generateOverview } from "../../../src/tools/overview.js";

describe("decision-support output contract", () => {
  const tempDir = fs.mkdtempSync(path.join("/tmp", "archgraph-output-contract-"));
  const archgraphDir = path.join(tempDir, ".pi", "archgraph");
  let db: ReturnType<typeof getDb>;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);

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
      ],
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("inspect output includes a concise priority hint alongside confidence wording", async () => {
    const output = await inspectSymbol(tempDir, "SessionCoordinator", { kind: "class" });
    expect(typeof output).toBe("string");

    expect(output).toMatch(/next step|recommendation/i);
    expect(output).toMatch(/priority/i);
    expect(output).toMatch(/confidence|uncertainty/i);
  });

  it("impact output includes a concise priority hint alongside confidence wording", async () => {
    const output = await getImpactForTarget(tempDir, "SessionCoordinator");
    expect(typeof output).toBe("string");

    expect(output).toMatch(/next step|recommendation/i);
    expect(output).toMatch(/priority/i);
    expect(output).toMatch(/confidence|uncertainty/i);
  });

  it("overview output includes a concise priority hint alongside confidence wording", async () => {
    const output = await generateOverview(tempDir);
    expect(typeof output).toBe("string");

    expect(output).toMatch(/next step|recommendation/i);
    expect(output).toMatch(/priority/i);
    expect(output).toMatch(/confidence|uncertainty/i);
  });
});
