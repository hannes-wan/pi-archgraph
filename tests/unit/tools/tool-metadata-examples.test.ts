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

describe("archgraph tool metadata descriptions carry required-parameter cues and an example", () => {
  it("archgraph_inspect.description mentions required 'query' and includes a copy/paste example", () => {
    const tools = getRegisteredTools();
    const inspect = tools.find((t) => t.name === "archgraph_inspect");
    expect(inspect).toBeTruthy();

    expect(inspect.description).toMatch(/\bquery\b/i);
    expect(inspect.description).toMatch(/archgraph_inspect\(\{\s*query:/);
  });

  it("archgraph_impact.description mentions required 'target' and includes a copy/paste example", () => {
    const tools = getRegisteredTools();
    const impact = tools.find((t) => t.name === "archgraph_impact");
    expect(impact).toBeTruthy();

    expect(impact.description).toMatch(/\btarget\b/i);
    expect(impact.description).toMatch(/archgraph_impact\(\{\s*target:/);
  });
});
