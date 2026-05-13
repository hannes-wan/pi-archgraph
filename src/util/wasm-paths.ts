/**
 * Robust WASM path resolution utility.
 * Supports multiple resolution strategies for different environments.
 */

import * as path from "node:path";
import * as url from "node:url";
import * as fs from "node:fs/promises";

/**
 * Get the base directory for the package, using multiple fallback strategies.
 * 
 * Strategies (in order of preference):
 * 1. import.meta.url (ESM standard)
 * 2. process.cwd() (fallback for CommonJS or test environments)
 * 3. require.resolve (last resort)
 */
import * as fs_sync from "node:fs";

export function getPackageBaseDir(): string {
  let current = "";
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      current = path.dirname(url.fileURLToPath(import.meta.url));
    }
  } catch {
    current = process.cwd();
  }

  if (!current) current = process.cwd();

  // Search upwards for package.json
  while (current !== path.dirname(current)) {
    if (fs_sync.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }

  return process.cwd();
}

/**
 * Resolve a WASM file path using multiple fallback locations.
 * 
 * @param wasmRelativePath - Path relative to node_modules (e.g., "tree-sitter-wasms/out/tree-sitter-cpp.wasm")
 * @param baseDir - Optional base directory override
 * @returns Absolute path to the WASM file
 */
export async function resolveWasmPath(
  wasmRelativePath: string,
  baseDir?: string
): Promise<string> {
  const base = baseDir ?? getPackageBaseDir();

  // Try multiple potential locations
  const candidates = [
    // 1. Standard: relative to package base (development)
    path.resolve(base, "node_modules", wasmRelativePath),
    // 2. Installed as dependency: relative to cwd
    path.resolve(process.cwd(), "node_modules", wasmRelativePath),
    // 3. Global/workspace installation
    path.resolve(process.cwd(), wasmRelativePath),
    // 4. Absolute path (if user provided it directly)
    wasmRelativePath,
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  // Return first candidate as fallback (will likely fail with clear error)
  return candidates[0];
}

/**
 * Synchronous WASM path resolution for use in class constructors.
 * Uses the most reliable strategy without async file access.
 * 
 * @param wasmRelativePath - Path relative to node_modules
 * @returns Resolved absolute path
 */
export function resolveWasmPathSync(wasmRelativePath: string): string {
  const base = getPackageBaseDir();

  // Standard development path
  const standardPath = path.resolve(base, "node_modules", wasmRelativePath);
  
  // Validate path looks reasonable (contains node_modules)
  if (standardPath.includes("node_modules")) {
    return standardPath;
  }

  // Fallback to cwd-based resolution
  return path.resolve(process.cwd(), "node_modules", wasmRelativePath);
}

/**
 * Lazy WASM loader that defers path resolution until first use.
 * Useful for frontends that may not be used.
 */
export class LazyWasmPath {
  private resolved: string | null = null;
  private readonly relativePath: string;

  constructor(relativePath: string) {
    this.relativePath = relativePath;
  }

  async get(): Promise<string> {
    if (!this.resolved) {
      this.resolved = await resolveWasmPath(this.relativePath);
    }
    return this.resolved;
  }

  getSync(): string {
    if (!this.resolved) {
      this.resolved = resolveWasmPathSync(this.relativePath);
    }
    return this.resolved;
  }
}
