import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock overview generation to keep test fast/deterministic.
vi.mock("../../src/tools/overview.js", () => ({
  generateOverview: vi.fn(async () => "(mock overview)"),
}));

// Mock sessionStartHook so the extension injects the "Available" policy.
vi.mock("../../src/tools/hooks.js", async () => {
  const actual = await vi.importActual<any>("../../src/tools/hooks.js");
  return {
    ...actual,
    sessionStartHook: vi.fn(async () => ({
      state: "ready",
      needsInit: false,
      needsUpdate: false,
      reason: "Graph is ready.",
      dirtyFiles: [],
    })),
  };
});

import registerExtension from "../../src/index.js";

function getHook(pi: any, name: string) {
  const h = pi._hooks.get(name);
  if (!h) throw new Error(`missing hook ${name}`);
  return h;
}

describe("before_agent_start prompt injection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "archgraph-index-test-"));
  });

  it("routes questions to targeted archgraph tools (overview vs inspect vs impact)", async () => {
    const pi = {
      _hooks: new Map<string, any>(),
      on(name: string, fn: any) {
        this._hooks.set(name, fn);
      },
      registerTool() {},
    };

    registerExtension(pi as any);

    const beforeAgentStart = getHook(pi, "before_agent_start");
    const res = await beforeAgentStart(
      { systemPrompt: "BASE" },
      { cwd: tempDir, ui: { notify() {}, setStatus() {} } },
    );

    expect(res.systemPrompt).toContain("# Architecture Graph — Available");

    // The injected guidance must be explicit about which tool to use for which question type.
    expect(res.systemPrompt).toMatch(/broad\s+orientation[^\n]*archgraph_overview/i);
    expect(res.systemPrompt).toMatch(/concrete\s+symbol[^\n]*archgraph_inspect/i);
    expect(res.systemPrompt).toMatch(/blast-?radius[^\n]*archgraph_impact/i);

    // Usability: show copy-pasteable, schema-valid example calls so agents know which args to pass.
    // NOTE: These must match the real tool signatures in src/tools/tools.ts.
    expect(res.systemPrompt).toContain("archgraph_inspect({ query: \"hashString\" })");
    expect(res.systemPrompt).toContain(
      "archgraph_inspect({ query: \"Shape\", kind: \"trait\", file: \"src/rust/shapes.rs\" })",
    );
    expect(res.systemPrompt).toContain("archgraph_inspect({ query: \"GraphNode\", depth: 3, format: \"mermaid\" })");
    expect(res.systemPrompt).toContain("archgraph_impact({ target: \"serializeNodeMetadata\" })");
  });
});
