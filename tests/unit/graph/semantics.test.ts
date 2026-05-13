import { describe, it, expect } from "vitest";
import { getEdgeDirectionDescription, serializeNodeMetadata, validateEdgeDirection } from "../../../src/graph/semantics.js";

describe("graph semantics", () => {
  it("documents edge direction contracts", () => {
    expect(getEdgeDirectionDescription("calls")).toBe("caller -> callee");
    expect(getEdgeDirectionDescription("implements")).toBe("implementation -> interface");
    expect(getEdgeDirectionDescription("writes")).toBe("writer -> resource");
  });

  it("validates edge shape", () => {
    expect(() => validateEdgeDirection({
      id: "e1",
      from_id: "a",
      to_id: "b",
      kind: "calls",
      confidence: 1,
      metadata_json: null,
    })).not.toThrow();
  });

  it("validates typed node metadata", () => {
    expect(serializeNodeMetadata("function", { async: true, exported: false })).toContain("\"async\":true");
    expect(() => serializeNodeMetadata("class", { abstract: "nope" as any })).toThrow();
  });
});
