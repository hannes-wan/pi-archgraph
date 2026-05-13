import { describe, it, expect } from "vitest";
import { registerArchgraphTools } from "../../../src/tools/tools.js";

function getRegisteredTools() {
  const tools: any[] = [];
  const pi = {
    registerTool(tool: any) {
      tools.push(tool);
    },
  } as any;

  registerArchgraphTools(pi);
  return tools;
}

describe("archgraph_overview prompt guidance", () => {
  it("does not over-prescribe overview and nudges inspect/impact", () => {
    const tools = getRegisteredTools();
    const overview = tools.find((t) => t.name === "archgraph_overview");
    expect(overview).toBeTruthy();

    // Avoid over-weighting overview for general work; keep it scoped to broad discovery.
    expect(overview.description).not.toMatch(/FIRST step for any broad project question/i);

    // Ensure the overview tool itself nudges the agent toward more targeted tools.
    const guidance = (overview.promptGuidelines || []).join("\n");
    expect(guidance).toMatch(/archgraph_inspect/i);
    expect(guidance).toMatch(/archgraph_impact/i);
  });
});
