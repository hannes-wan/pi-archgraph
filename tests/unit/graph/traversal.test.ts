import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "../../../src/graph/db.js";
import { GraphTraversal } from "../../../src/graph/traversal.js";
import { GraphAnalyzer } from "../../../src/graph/analyzer.js";
import { setGraphRevision, getGraphRevision } from "../../../src/graph/metadata.js";

describe("graph traversal and analyzer", () => {
  const tempDir = fs.mkdtempSync(path.join("/tmp", "archgraph-traversal-test-"));
  const archgraphDir = path.join(tempDir, ".pi", "archgraph");
  let db: ReturnType<typeof getDb>;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);
    db.exec(`
      INSERT INTO nodes (id, kind, name, qualified_name, file_path, domain, subsystem) VALUES
      ('module:app', 'module', 'app', 'app', '/src/app.ts', 'runtime', 'src/runtime'),
      ('service:mail', 'service', 'mail', 'mail', '/src/runtime/mail.ts', 'runtime', 'src/runtime'),
      ('function:run', 'function', 'run', 'run', '/src/runtime/app.ts', 'runtime', 'src/runtime'),
      ('function:helper', 'function', 'helper', 'helper', '/src/tools/helper.ts', 'tools', 'src/tools');

      INSERT INTO edges (id, from_id, to_id, kind, confidence, source_file) VALUES
      ('depends:app:mail', 'module:app', 'service:mail', 'depends_on', 1.0, '/src/app.ts'),
      ('calls:run:mail', 'function:run', 'service:mail', 'calls', 1.0, '/src/runtime/app.ts'),
      ('calls:helper:run', 'function:helper', 'function:run', 'calls', 1.0, '/src/tools/helper.ts');

      INSERT INTO files (path, domain, subsystem, symbol_count, edge_count) VALUES
      ('/src/app.ts', 'runtime', 'src/runtime', 1, 1),
      ('/src/runtime/mail.ts', 'runtime', 'src/runtime', 1, 1),
      ('/src/runtime/app.ts', 'runtime', 'src/runtime', 1, 1),
      ('/src/tools/helper.ts', 'tools', 'src/tools', 1, 1);
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("supports inbound/outbound traversal with architecture semantics", () => {
    const traversal = new GraphTraversal(db);
    expect(traversal.fanIn("service:mail")).toBe(2);
    expect(traversal.fanOut("function:helper")).toBe(1);
    expect(traversal.shortestPath("function:helper", "service:mail")).toEqual(["function:helper", "function:run", "service:mail"]);
  });

  it("analyzes hubs with fan-in weighted centrality", () => {
    const analyzer = new GraphAnalyzer(db);
    const ranked = analyzer.rankNodes();
    expect(ranked[0].node.id).toBe("service:mail");
    expect(ranked[0].fan_in).toBe(2);
  });

  it("stores and loads graph revision metadata", () => {
    setGraphRevision(db, {
      graphRevision: "rev-1",
      indexedCommit: "abc123",
      workspaceId: "ws-1",
      indexedAt: 123,
    });

    expect(getGraphRevision(db)).toEqual({
      graphRevision: "rev-1",
      indexedCommit: "abc123",
      workspaceId: "ws-1",
      indexedAt: 123,
    });
  });
});
