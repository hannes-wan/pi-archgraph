import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const acquireLock = vi.fn(async () => vi.fn(async () => {}));
vi.mock("../../../src/graph/lock.js", () => ({ acquireLock }));

const { updateGraph } = await import("../../../src/core/workspace-indexer.js");

describe("workspace indexer write locking", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "archgraph-lock-test-"));
    projectDir = path.join(tempDir, "project");
    await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020" } }));
    await fs.writeFile(path.join(projectDir, "src", "service.ts"), "export class Service { start() { return true; } }");
    acquireLock.mockClear();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("acquires a write lock before persisting graph updates", async () => {
    await updateGraph(projectDir);

    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(acquireLock).toHaveBeenCalledWith(projectDir);
  });
});
