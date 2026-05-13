import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  sessionStartHook,
  isFileInProject,
  toolCallHook,
  needsSmartInit,
  shouldUpdateFile,
  normalizeProjectFilePath,
  resolveUpdateTargets,
} from "../../../src/tools/hooks.js";
import { setMeta, getMeta } from "../../../src/util/meta.js";
import { hashFile } from "../../../src/util/hashing.js";
import { getDb } from "../../../src/graph/db.js";
import { getArchgraphDir } from "../../../src/util/paths.js";

describe("hooks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "archgraph-test-"));
  });

  describe("sessionStartHook", () => {
    it("returns needsInit=true when no meta.json exists", async () => {
      const result = await sessionStartHook(tempDir);
      expect(result.needsInit).toBe(true);
      expect(result.reason).toBe("No existing graph metadata found.");
    });

    it("returns needsInit=true when schema version mismatches", async () => {
      await setMeta(tempDir, {
        schemaVersion: 1,
        indexedAt: Date.now(),
      });

      const result = await sessionStartHook(tempDir);
      expect(result.needsInit).toBe(true);
      expect(result.reason).toContain("Schema version mismatch");
    });

    it("returns needsUpdate=true when dirty files exist", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: ["src/file.ts"],
      });

      const result = await sessionStartHook(tempDir);
      expect(result.needsInit).toBe(false);
      expect(result.needsUpdate).toBe(true);
      expect(result.reason).toContain("dirty files pending graph update");
    });

    it("returns needsInit=false when graph is current", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [],
      });
      const db = getDb(getArchgraphDir(tempDir));
      db.close();

      const result = await sessionStartHook(tempDir);
      expect(result.needsInit).toBe(false);
      expect(result.needsUpdate).toBe(false);
      expect(result.reason).toBe("Graph is ready.");
    });

    it("returns needsInit=true when graph metadata exists but db is missing", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now() - 10 * 60 * 1000,
        dirtyFiles: [],
      });

      const result = await sessionStartHook(tempDir);
      expect(result.needsInit).toBe(true);
      expect(result.reason).toContain("graph database is missing");
    });
  });

  describe("isFileInProject", () => {
    it("returns true for files within project", () => {
      const cwd = "/home/user/project";
      expect(isFileInProject(cwd, "/home/user/project/src/file.ts")).toBe(true);
      expect(isFileInProject(cwd, "/home/user/project/src/nested/file.ts")).toBe(true);
    });

    it("returns false for files outside project", () => {
      const cwd = "/home/user/project";
      expect(isFileInProject(cwd, "/home/user/other/file.ts")).toBe(false);
      expect(isFileInProject(cwd, "/home/user/project-sibling/file.ts")).toBe(false);
    });

    it("handles relative paths", () => {
      const cwd = "/home/user/project";
      expect(isFileInProject(cwd, "src/file.ts")).toBe(true);
    });

    it("normalizes project paths to absolute paths", () => {
      const cwd = "/home/user/project";
      expect(normalizeProjectFilePath(cwd, "src/file.ts")).toBe(path.resolve(cwd, "src/file.ts"));
      expect(normalizeProjectFilePath(cwd, "/tmp/outside.ts")).toBeNull();
    });
  });

  describe("toolCallHook", () => {
    it("returns empty array for non-write tools", async () => {
      const result = await toolCallHook(tempDir, "archgraph_search", { query: "test" });
      expect(result).toEqual({ dirtyFiles: [], promptSnippet: undefined });
    });

    it("extracts path from params.path", async () => {
      const filePath = path.join(tempDir, "src", "test.ts");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "content");

      const result = await toolCallHook(tempDir, "write", { path: filePath });
      expect(result.dirtyFiles).toContain(filePath);
    });

    it("extracts files from params.files array", async () => {
      const filePath = path.join(tempDir, "src", "test.ts");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "content");

      const result = await toolCallHook(tempDir, "write", { files: [filePath] });
      expect(result.dirtyFiles).toContain(filePath);
    });

    it("filters out files outside project", async () => {
      const result = await toolCallHook(tempDir, "write", { path: "/tmp/outside.ts" });
      expect(result.dirtyFiles).not.toContain("/tmp/outside.ts");
    });

    it("does not add exploration guidance for broad read calls when graph is ready", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [],
      });
      const db = getDb(getArchgraphDir(tempDir));
      db.close();

      const result = await toolCallHook(tempDir, "read", { path: "README.md" });
      expect(result.dirtyFiles).toEqual([]);
      expect(result.promptSnippet).toBeUndefined();
    });

    it("does not add exploration guidance for specific file reads", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [],
      });
      const db = getDb(getArchgraphDir(tempDir));
      db.close();

      const result = await toolCallHook(tempDir, "read", { path: "src/mail.rs" });
      expect(result.promptSnippet).toBeUndefined();
    });

    it("forces update guidance when graph has dirty files", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [path.join(tempDir, "src", "mail.rs")],
      });

      const result = await toolCallHook(tempDir, "read", { path: "README.md" });
      expect(result.promptSnippet).toContain("Run archgraph_update before relying on architecture graph results.");
    });

    it("requires init guidance when graph db is missing", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now() - 10 * 60 * 1000,
        dirtyFiles: [],
      });

      const result = await toolCallHook(tempDir, "read", { path: "README.md" });
      expect(result.promptSnippet).toContain("Archgraph needs a rebuild. Run archgraph_init with force=true");
    });
  });

  describe("shouldUpdateFile", () => {
    it("returns true for new files", async () => {
      const filePath = path.join(tempDir, "new.ts");
      await fs.writeFile(filePath, "content");

      const result = await shouldUpdateFile(tempDir, filePath, null);
      expect(result).toBe(true);
    });

    it("returns true when hash differs", async () => {
      const filePath = path.join(tempDir, "modified.ts");
      await fs.writeFile(filePath, "original content");

      const result = await shouldUpdateFile(tempDir, filePath, "different-hash");
      expect(result).toBe(true);
    });

    it("returns false when hash matches", async () => {
      const filePath = path.join(tempDir, "unchanged.ts");
      await fs.writeFile(filePath, "content");

      const currentHash = await hashFile(filePath);
      const result = await shouldUpdateFile(tempDir, filePath, currentHash);
      expect(result).toBe(false);
    });
  });

  describe("needsSmartInit", () => {
    it("delegates to sessionStartHook", async () => {
      const result = await needsSmartInit(tempDir, 2);
      expect(result.needsInit).toBe(true);
    });
  });

  describe("resolveUpdateTargets", () => {
    it("prefers explicit files and normalizes them", async () => {
      const result = await resolveUpdateTargets(tempDir, ["src/a.ts"]);
      expect(result.source).toBe("explicit");
      expect(result.files).toEqual([path.join(tempDir, "src", "a.ts")]);
    });

    it("falls back to dirty files when explicit files are omitted", async () => {
      const dirtyPath = path.join(tempDir, "src", "dirty.ts");
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [dirtyPath],
      });

      const result = await resolveUpdateTargets(tempDir);
      expect(result.source).toBe("dirty");
      expect(result.files).toEqual([dirtyPath]);
    });

    it("falls back to tracked files when no explicit or dirty files exist", async () => {
      await setMeta(tempDir, {
        schemaVersion: 2,
        indexedAt: Date.now(),
        dirtyFiles: [],
      });

      const db = getDb(getArchgraphDir(tempDir));
      db.prepare("INSERT INTO files (path, hash, mtime, language, last_indexed_at) VALUES (?, ?, ?, ?, ?)")
        .run(path.join(tempDir, "src", "tracked.ts"), "hash", Date.now(), "typescript", Date.now());
      db.close();

      const result = await resolveUpdateTargets(tempDir);
      expect(result.source).toBe("tracked");
      expect(result.files).toEqual([path.join(tempDir, "src", "tracked.ts")]);
    });
  });
});
