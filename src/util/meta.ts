import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getArchgraphDir } from "./paths.js";

export interface MetaData {
  schemaVersion: number;
  indexedCommit: string | null;
  indexedAt: number;
  dirtyFiles: string[];
  lastUpdateReason: string | null;
}

export async function getMeta(cwd: string): Promise<MetaData | null> {
  const archgraphDir = getArchgraphDir(cwd);
  const metaPath = path.join(archgraphDir, "meta.json");

  try {
    const content = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function setMeta(cwd: string, meta: Partial<MetaData>): Promise<void> {
  const archgraphDir = getArchgraphDir(cwd);
  const metaPath = path.join(archgraphDir, "meta.json");

  // Ensure directory exists
  await fs.mkdir(archgraphDir, { recursive: true });

  const current = await getMeta(cwd);
  const updated: MetaData = {
    schemaVersion: current?.schemaVersion ?? 2,
    indexedCommit: current?.indexedCommit ?? null,
    indexedAt: current?.indexedAt ?? Date.now(),
    dirtyFiles: current?.dirtyFiles ?? [],
    lastUpdateReason: current?.lastUpdateReason ?? null,
    ...meta,
  };

  await fs.writeFile(metaPath, JSON.stringify(updated, null, 2), "utf-8");
}

export async function markDirty(cwd: string, files: string[]): Promise<void> {
  const current = await getMeta(cwd);
  const dirtyFiles = new Set([...current?.dirtyFiles ?? [], ...files]);
  await setMeta(cwd, { dirtyFiles: Array.from(dirtyFiles) });
}

export async function clearDirty(cwd: string): Promise<void> {
  await setMeta(cwd, { dirtyFiles: [] });
}

export async function isStale(cwd: string, thresholdMs: number = 60000): Promise<boolean> {
  const meta = await getMeta(cwd);
  if (!meta) return true;

  return Date.now() - meta.indexedAt > thresholdMs;
}
