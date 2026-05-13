import * as lockfile from "proper-lockfile";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { getArchgraphDir } from "../util/paths.js";

export async function acquireLock(cwd: string): Promise<() => Promise<void>> {
  const dir = getArchgraphDir(cwd);
  const lockDir = path.join(dir, "locks");
  const lockFilePath = path.join(lockDir, "write.lock");

  await fs.mkdir(lockDir, { recursive: true });

  // Ensure the lock file exists
  try {
    await fs.writeFile(lockFilePath, "", { flag: "a" });
  } catch {
    // ignore bootstrap races
  }

  const release = await lockfile.lock(lockFilePath, {
    stale: 60_000,
    update: 5_000,
    realpath: false,
    retries: {
      retries: 20,
      factor: 1.5,
      minTimeout: 250,
      maxTimeout: 2_000,
    },
  });
  
  return release;
}
