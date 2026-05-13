import * as lockfile from "proper-lockfile";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { getArchgraphDir } from "../util/paths.js";

export async function acquireLock(cwd: string): Promise<() => Promise<void>> {
  const dir = getArchgraphDir(cwd);
  const lockDir = path.join(dir, "locks");
  const lockFilePath = path.join(lockDir, "write.lock");
  
  // Ensure the lock file exists
  try {
    await fs.writeFile(lockFilePath, "");
  } catch (err) {
    // Ignore error if it exists
  }
  
  const release = await lockfile.lock(lockFilePath, {
    retries: {
      retries: 5,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 2000,
    }
  });
  
  return release;
}
