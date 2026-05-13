import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  getPackageBaseDir,
  resolveWasmPath,
  resolveWasmPathSync,
  LazyWasmPath,
} from "../../../src/util/wasm-paths.js";

describe("wasm-paths", () => {
  describe("getPackageBaseDir", () => {
    it("returns a valid directory path", () => {
      const baseDir = getPackageBaseDir();
      expect(baseDir).toBeTruthy();
      expect(typeof baseDir).toBe("string");
    });
  });

  describe("resolveWasmPathSync", () => {
    it("returns a path string", () => {
      const wasmPath = resolveWasmPathSync("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
      expect(typeof wasmPath).toBe("string");
      expect(wasmPath).toContain("tree-sitter-cpp.wasm");
    });

    it("includes node_modules in the path", () => {
      const wasmPath = resolveWasmPathSync("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
      expect(wasmPath).toContain("node_modules");
    });
  });

  describe("LazyWasmPath", () => {
    it("creates with relative path", () => {
      const lazyPath = new LazyWasmPath("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
      expect(lazyPath).toBeDefined();
    });

    it("getSync returns a path synchronously", () => {
      const lazyPath = new LazyWasmPath("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
      const path = lazyPath.getSync();
      expect(path).toBeTruthy();
      expect(typeof path).toBe("string");
    });

    it("caches the resolved path", async () => {
      const lazyPath = new LazyWasmPath("tree-sitter-wasms/out/tree-sitter-cpp.wasm");
      const path1 = await lazyPath.get();
      const path2 = await lazyPath.get();
      expect(path1).toBe(path2);
    });
  });
});
