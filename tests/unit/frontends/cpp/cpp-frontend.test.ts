import { describe, it, expect, beforeEach } from "vitest";
import { CppFrontend } from "../../../../src/frontends/cpp/cpp-frontend.js";

describe("CppFrontend", () => {
  let frontend: CppFrontend;

  beforeEach(() => {
    frontend = new CppFrontend();
  });

  it("supports common C++ header and source extensions", () => {
    expect(frontend.supports("main.cpp")).toBe(true);
    expect(frontend.supports("widget.h")).toBe(true);
    expect(frontend.supports("widget.hpp")).toBe(true);
    expect(frontend.supports("widget.ts")).toBe(false);
  });

  it("indexes class definitions but ignores forward declarations", async () => {
    const filePath = "/tmp/sample.h";
    const content = `
class AuthService;

class SessionCoordinator : public QObject {
public:
  int currentRoomId() const;
};
`;

    const result = await frontend.parseFile(filePath, content);

    const classNodes = result.nodes.filter((node) => node.kind === "class");
    expect(classNodes.some((node) => node.name === "SessionCoordinator")).toBe(true);
    expect(classNodes.some((node) => node.name === "AuthService")).toBe(false);
  });

  it("normalizes local includes and emits file-level dependencies", async () => {
    const filePath = "/tmp/src/SessionCoordinator.h";
    const content = `
#include "../protocol/AuthService.h"

class SessionCoordinator {
};
`;

    const result = await frontend.parseFile(filePath, content);
    const includeEdge = result.edges.find((edge) => edge.kind === "depends_on" && edge.from_id === `file:${filePath}`);

    expect(includeEdge?.to_id).toBe("/tmp/protocol/AuthService.h");
  });

  it("emits symbol-level type references and call edges", async () => {
    const filePath = "/tmp/sample.cpp";
    const content = `
class AuthService {};
class SessionCoordinator {
public:
  AuthService* authService;
};

void boot(SessionCoordinator* coordinator, AuthService* auth) {
  auth->connect();
}
`;

    const result = await frontend.parseFile(filePath, content);
    const sessionCoordinatorId = `class:${filePath}:SessionCoordinator`;
    const bootId = `function:${filePath}:boot`;

    expect(result.edges.some((edge) =>
      edge.kind === "depends_on" &&
      edge.from_id === sessionCoordinatorId &&
      edge.to_id === "AuthService"
    )).toBe(true);

    expect(result.edges.some((edge) =>
      edge.kind === "depends_on" &&
      edge.from_id === bootId &&
      edge.to_id === "SessionCoordinator"
    )).toBe(true);

    expect(result.edges.some((edge) =>
      edge.kind === "calls" &&
      edge.from_id === bootId &&
      edge.to_id.includes("connect")
    )).toBe(true);
  });

  it("skips malformed call edges for parenthesized callable expressions", async () => {
    const filePath = "/tmp/numeric-limits.cpp";
    const content = `
#include <limits>
#include <cstdint>

template <typename T>
constexpr size_t num_possible_values() {
  return static_cast<size_t>(
    static_cast<intmax_t>((std::numeric_limits<T>::max)()) -
    static_cast<intmax_t>((std::numeric_limits<T>::min)()) + 1);
}
`;

    const result = await frontend.parseFile(filePath, content);

    expect(result.edges.some((edge) => edge.kind === "calls" && !edge.to_id)).toBe(false);
    expect(result.edges.some((edge) => edge.kind === "reads" && !edge.to_id)).toBe(false);
  });
});
