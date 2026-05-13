import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getMeta, setMeta } from "../util/meta.js";
import { getArchgraphDir } from "../util/paths.js";
import { hashFile } from "../util/hashing.js";
import { getDb } from "../graph/db.js";

/**
 * Hook system for pi-archgraph.
 *
 * Responsibilities:
 * - detect whether the graph needs init/update
 * - mark files dirty after write-like tool calls
 * - resolve update targets for archgraph_update
 *
 * Non-goals:
 * - do not replace the runtime orchestrator
 * - do not constantly steer normal exploration/read behavior
 * - do not use time-based stale checks
 */

export type GraphState =
  | "missing"
  | "ready"
  | "dirty"
  | "schema_mismatch"
  | "corrupted";

export interface SmartInitResult {
  needsInit: boolean;
  needsUpdate: boolean;
  state: GraphState;
  reason: string;
  indexedAt?: number;
  dirtyFiles?: string[];
}

export interface FileUpdateCheck {
  file: string;
  needsUpdate: boolean;
  reason: "new" | "modified" | "unchanged" | "deleted";
  currentHash?: string;
  storedHash?: string;
}

export interface ToolCallHookResult {
  dirtyFiles: string[];
  promptSnippet?: string;
}

export interface UpdateTargetResolution {
  source: "explicit" | "dirty" | "tracked";
  files: string[];
}

const DEFAULT_SCHEMA_VERSION = 2;

const WRITE_TOOL_PATTERNS = [
  "write",
  "edit",
  "create",
  "save",
  "patch",
  "replace",
  "rename",
  "move",
  "delete",
  "remove",
];

const NON_SOURCE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".lock",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".pdf",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".hh",
  ".hxx",
]);

/**
 * session_start hook.
 *
 * Important distinction:
 * - missing/schema mismatch/corruption => needsInit
 * - dirty files => needsUpdate
 */
export async function sessionStartHook(
  cwd: string,
  expectedSchemaVersion: number = DEFAULT_SCHEMA_VERSION,
): Promise<SmartInitResult> {
  const meta = await getMeta(cwd);

  if (!meta) {
    return {
      needsInit: true,
      needsUpdate: false,
      state: "missing",
      reason: "No existing graph metadata found.",
    };
  }

  if (meta.schemaVersion !== expectedSchemaVersion) {
    return {
      needsInit: true,
      needsUpdate: false,
      state: "schema_mismatch",
      reason: `Schema version mismatch: found ${meta.schemaVersion}, expected ${expectedSchemaVersion}.`,
      indexedAt: meta.indexedAt,
    };
  }

  const dirtyFiles = Array.from(
    new Set(
      (meta.dirtyFiles ?? [])
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string"),
    ),
  );

  if (dirtyFiles.length > 0) {
    return {
      needsInit: false,
      needsUpdate: true,
      state: "dirty",
      reason: `${dirtyFiles.length} dirty files pending graph update.`,
      indexedAt: meta.indexedAt,
      dirtyFiles,
    };
  }

  const dbExists = await graphDbExists(cwd);
  if (!dbExists) {
    return {
      needsInit: true,
      needsUpdate: false,
      state: "corrupted",
      reason: "Graph metadata exists but graph database is missing.",
      indexedAt: meta.indexedAt,
    };
  }

  return {
    needsInit: false,
    needsUpdate: false,
    state: "ready",
    reason: "Graph is ready.",
    indexedAt: meta.indexedAt,
  };
}

/**
 * Backward-compatible helper used by archgraph_init.
 *
 * NOTE:
 * dirty graph no longer means needsInit.
 */
export async function needsSmartInit(
  cwd: string,
  expectedSchemaVersion: number = DEFAULT_SCHEMA_VERSION,
): Promise<SmartInitResult> {
  return sessionStartHook(cwd, expectedSchemaVersion);
}

/**
 * Runtime tool-call hook.
 *
 * It marks source files dirty after write-like tool calls.
 * It only emits guidance when the graph is clearly unavailable or dirty.
 */
export async function toolCallHook(
  cwd: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolCallHookResult> {
  const normalizedTool = toolName.toLowerCase();

  if (normalizedTool.startsWith("archgraph_")) {
    return { dirtyFiles: [] };
  }

  const promptSnippet = await getStateGuidancePrompt(cwd);

  if (!isWriteLikeTool(normalizedTool)) {
    return {
      dirtyFiles: [],
      promptSnippet,
    };
  }

  const filesToUpdate = extractFilePathsFromParams(params);

  const projectFiles = Array.from(
    new Set(
      filesToUpdate
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string")
        .filter(isSupportedSourceFile),
    ),
  );

  if (projectFiles.length > 0) {
    await markDirtyFiles(cwd, projectFiles);
  }

  return {
    dirtyFiles: projectFiles,
    promptSnippet,
  };
}

/**
 * Resolve update target files for archgraph_update.
 *
 * Priority:
 * 1. explicit files
 * 2. dirty files from meta
 * 3. tracked files in graph DB
 */
export async function resolveUpdateTargets(
  cwd: string,
  requestedFiles?: string[],
): Promise<UpdateTargetResolution> {
  const explicitFiles = Array.from(
    new Set(
      (requestedFiles ?? [])
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string")
        .filter(isSupportedSourceFile),
    ),
  );

  if (explicitFiles.length > 0) {
    return { source: "explicit", files: explicitFiles };
  }

  const meta = await getMeta(cwd);
  const dirtyFiles = Array.from(
    new Set(
      (meta?.dirtyFiles ?? [])
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string")
        .filter(isSupportedSourceFile),
    ),
  );

  if (dirtyFiles.length > 0) {
    return { source: "dirty", files: dirtyFiles };
  }

  return {
    source: "tracked",
    files: await getTrackedFiles(cwd),
  };
}

/**
 * Compare current file hashes against stored hashes.
 */
export async function getFilesNeedingUpdate(
  cwd: string,
  files: string[],
): Promise<string[]> {
  const normalizedFiles = Array.from(
    new Set(
      files
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string")
        .filter(isSupportedSourceFile),
    ),
  );

  if (normalizedFiles.length === 0) {
    return [];
  }

  const archgraphDir = getArchgraphDir(cwd);
  let db;

  try {
    db = getDb(archgraphDir);
  } catch {
    return normalizedFiles;
  }

  try {
    const stmt = db.prepare("SELECT path, hash FROM files WHERE path = ?");
    const result: string[] = [];

    for (const file of normalizedFiles) {
      const row = stmt.get(file) as
        | { path: string; hash: string | null }
        | undefined;

      const needsUpdate = await shouldUpdateFile(cwd, file, row?.hash ?? null);
      if (needsUpdate) {
        result.push(file);
      }
    }

    return result;
  } finally {
    db.close();
  }
}

/**
 * Determine whether a file should be updated in the graph.
 */
export async function shouldUpdateFile(
  cwd: string,
  filePath: string,
  storedHash: string | null,
): Promise<boolean> {
  const normalized = normalizeProjectFilePathSync(cwd, filePath);
  if (!normalized) {
    return false;
  }

  try {
    const currentHash = await hashFile(normalized);

    if (!currentHash) {
      return true;
    }

    if (storedHash === null) {
      return true;
    }

    return currentHash !== storedHash;
  } catch {
    return true;
  }
}

/**
 * Clear dirty files after successful update.
 */
export async function clearDirtyAfterUpdate(
  cwd: string,
  updatedFiles: string[],
): Promise<void> {
  try {
    const meta = await getMeta(cwd);
    if (!meta) return;

    const dirtySet = new Set(
      (meta.dirtyFiles ?? [])
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string"),
    );

    for (const file of updatedFiles) {
      const normalized = normalizeProjectFilePathSync(cwd, file);
      if (normalized) {
        dirtySet.delete(normalized);
      }
    }

    await setMeta(cwd, {
      dirtyFiles: Array.from(dirtySet),
      lastUpdateReason: dirtySet.size > 0 ? "partial update remaining" : null,
    });
  } catch {
    // best-effort only
  }
}

/**
 * Project path check.
 *
 * This is sync and lexical by design because most hook paths may not exist yet
 * immediately after a planned write. For stricter symlink protection, move this
 * to an async realpath-based version where call sites can await it.
 */
export function isFileInProject(cwd: string, filePath: string): boolean {
  const cwdAbs = path.resolve(cwd);
  const fileAbs = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(cwdAbs, filePath);

  const rel = path.relative(cwdAbs, fileAbs);

  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Normalize project file path to absolute path.
 */
export function normalizeProjectFilePathSync(
  cwd: string,
  filePath: string,
): string | null {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return null;
  }

  if (!isFileInProject(cwd, filePath)) {
    return null;
  }

  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(cwd, filePath);
}

/**
 * Backward-compatible alias.
 */
export function normalizeProjectFilePath(
  cwd: string,
  filePath: string,
): string | null {
  return normalizeProjectFilePathSync(cwd, filePath);
}

async function markDirtyFiles(cwd: string, files: string[]): Promise<void> {
  try {
    const normalizedFiles = Array.from(
      new Set(
        files
          .map((file) => normalizeProjectFilePathSync(cwd, file))
          .filter((file): file is string => typeof file === "string")
          .filter(isSupportedSourceFile),
      ),
    );

    if (normalizedFiles.length === 0) return;

    const meta = await getMeta(cwd);
    const existingDirty = new Set(
      (meta?.dirtyFiles ?? [])
        .map((file) => normalizeProjectFilePathSync(cwd, file))
        .filter((file): file is string => typeof file === "string"),
    );

    for (const file of normalizedFiles) {
      existingDirty.add(file);
    }

    await setMeta(cwd, {
      dirtyFiles: Array.from(existingDirty),
      lastUpdateReason: "source files changed",
    });
  } catch {
    // best-effort only
  }
}

async function getTrackedFiles(cwd: string): Promise<string[]> {
  const archgraphDir = getArchgraphDir(cwd);
  let db;

  try {
    db = getDb(archgraphDir);
  } catch {
    return [];
  }

  try {
    const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;

    return Array.from(
      new Set(
        rows
          .map((row) => normalizeProjectFilePathSync(cwd, row.path))
          .filter((file): file is string => typeof file === "string")
          .filter(isSupportedSourceFile),
      ),
    );
  } finally {
    db.close();
  }
}

async function graphDbExists(cwd: string): Promise<boolean> {
  const archgraphDir = getArchgraphDir(cwd);

  const candidates = [
    path.join(archgraphDir, "graph.db"),
    path.join(archgraphDir, "archgraph.db"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return true;
    } catch {
      // continue
    }
  }

  return false;
}

function isWriteLikeTool(toolName: string): boolean {
  return WRITE_TOOL_PATTERNS.some((pattern) => toolName.includes(pattern));
}

function extractFilePathsFromParams(params: Record<string, unknown>): string[] {
  const files: string[] = [];

  const pushIfString = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      files.push(value);
    }
  };

  pushIfString(params.path);
  pushIfString(params.file);
  pushIfString(params.filename);
  pushIfString(params.target);
  pushIfString(params.dest);
  pushIfString(params.destination);

  if (Array.isArray(params.files)) {
    for (const value of params.files) {
      pushIfString(value);
    }
  }

  if (Array.isArray(params.paths)) {
    for (const value of params.paths) {
      pushIfString(value);
    }
  }

  return files;
}

function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();

  if (SOURCE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (NON_SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }

  return false;
}

async function getStateGuidancePrompt(cwd: string): Promise<string | undefined> {
  const state = await sessionStartHook(cwd, DEFAULT_SCHEMA_VERSION);

  if (state.state === "missing") {
    return "Archgraph is not initialized. Run archgraph_init before using architecture graph tools.";
  }

  if (state.state === "schema_mismatch" || state.state === "corrupted") {
    return "Archgraph needs a rebuild. Run archgraph_init with force=true before relying on architecture graph results.";
  }

  if (state.state === "dirty") {
    return `Archgraph has ${state.dirtyFiles?.length ?? 0} dirty source files. Run archgraph_update before relying on architecture graph results.`;
  }

  return undefined;
}
