import { describe, it, expect, beforeEach } from "vitest";
import { CFrontend } from "../../../../src/frontends/c/c-frontend.js";

describe("CFrontend", () => {
  let frontend: CFrontend;

  beforeEach(() => {
    frontend = new CFrontend();
  });

  it("supports c sources and headers but not cpp files", () => {
    expect(frontend.supports("main.c")).toBe(true);
    expect(frontend.supports("shape.h")).toBe(true);
    expect(frontend.supports("shape.cpp")).toBe(false);
  });

  it("emits owner-aware calls, normalized includes, and type references", async () => {
    const filePath = "/tmp/src/shape.c";
    const content = `
#include "../include/shape.h"

typedef struct Shape Shape;

int area(Shape* shape) {
  return read_shape(shape);
}
`;

    const result = await frontend.parseFile(filePath, content);
    const functionId = `function:${filePath}:area`;

    expect(result.edges.some((edge) =>
      edge.kind === "imports" &&
      edge.to_id === "/tmp/include/shape.h"
    )).toBe(true);

    expect(result.edges.some((edge) =>
      edge.kind === "depends_on" &&
      edge.from_id === functionId &&
      edge.to_id === "Shape"
    )).toBe(true);

    expect(result.edges.some((edge) =>
      edge.kind === "calls" &&
      edge.from_id === functionId &&
      edge.to_id === "read_shape"
    )).toBe(true);

    expect(result.edges.some((edge) =>
      edge.kind === "reads" &&
      edge.from_id === functionId
    )).toBe(true);
  });

  it("skips malformed call edges for parenthesized callable expressions", async () => {
    const filePath = "/tmp/numeric-limits.c";
    const content = `
#define WRAP(x) (x)

int value(void);

int area(void) {
  return (WRAP(value))();
}
`;

    const result = await frontend.parseFile(filePath, content);

    expect(result.edges.some((edge) => edge.kind === "calls" && !edge.to_id)).toBe(false);
    expect(result.edges.some((edge) => edge.kind === "reads" && !edge.to_id)).toBe(false);
  });
});
