import * as path from "node:path";
import * as fs from "node:fs/promises";

export function getArchgraphDir(cwd: string): string {
  return path.join(cwd, ".pi", "archgraph");
}

export async function ensureArchgraphDir(cwd: string): Promise<string> {
  const dir = getArchgraphDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "locks"), { recursive: true });
  await fs.mkdir(path.join(dir, "docs"), { recursive: true });
  return dir;
}

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "Makefile",
  "CMakeLists.txt",
  "WORKSPACE",
  "deno.json",
  "pnpm-workspace.yaml",
  "flake.nix",
  "Gemfile",
  "Project.toml",
  "mix.exs",
  "rebar.config",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
];

const SYSTEM_HIERARCHIES = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/var",
  "/opt",
  "/dev",
  "/proc",
  "/sys",
  "/tmp",
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
];

const EXACT_BLOCK_ROOTS = [
  "/",
  "/home",
  "/users",
  "c:\\",
];

/**
 * Safety check: Only auto-init if it looks like a real project.
 * Prevents indexing /, ~, or system folders by accident.
 */
export async function isSafeToAutoInit(cwd: string): Promise<boolean> {
  const abs = path.resolve(cwd);
  const absLower = abs.toLowerCase();

  // 1. Block exact root/parent matches
  if (EXACT_BLOCK_ROOTS.some((root) => absLower === root)) {
    return false;
  }

  // 2. Block top-level user home directories (regardless of current user)
  // Blocks /home/any_user or /Users/any_user but allows /home/any_user/project
  const parent = path.dirname(abs);
  const parentLower = parent.toLowerCase();
  if (parentLower === "/home" || parentLower === "/users" || absLower === "/root") {
    return false;
  }

  // 3. Block common home path for current user (safety fallback)
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && abs === path.resolve(home)) return false;

  // 4. Block system hierarchies (recursive)
  if (SYSTEM_HIERARCHIES.some((dir) => absLower === dir || absLower.startsWith(dir + path.sep))) {
    return false;
  }

  // 4. Check for project indicators
  for (const marker of PROJECT_MARKERS) {
    try {
      const s = await fs.stat(path.join(abs, marker));
      if (s) return true;
    } catch {
      // skip
    }
  }

  return false;
}
