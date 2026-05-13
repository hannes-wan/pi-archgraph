import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ignore from "ignore";
import { GraphAnalyzer } from "../graph/analyzer.js";
import { getDb } from "../graph/db.js";
import { setGraphRevision } from "../graph/metadata.js";
import { patchGraph } from "../graph/patch.js";
import { getArchgraphDir } from "../util/paths.js";
import { createFrontendManager } from "../frontends/index.js";
import { hashFile, hashString } from "../util/hashing.js";
import { GraphNode, GraphEdge, GraphFile } from "../graph/schema.js";
import { acquireLock } from "../graph/lock.js";

const execFileAsync = promisify(execFile);

export class WorkspaceIndexer {
  private frontends: ReturnType<typeof createFrontendManager> | null = null;

  async init() {
    if (!this.frontends) {
      this.frontends = await createFrontendManager();
    }
  }

  async updateGraph(cwd: string, filesToUpdate?: string[], onProgress?: (current: number, total: number) => void) {
    await this.init();

    const archgraphDir = getArchgraphDir(cwd);

    let filePaths = filesToUpdate;
    if (!filePaths || filePaths.length === 0) {
      filePaths = await this.getAllProjectFiles(cwd);
    }

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const allFiles: GraphFile[] = [];
    const deletedFiles: string[] = [];

    const concurrency = 8;
    const total = filePaths.length;
    let current = 0;

    const processFile = async (filePath: string) => {
      try {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) {
          deletedFiles.push(filePath);
          return;
        }

        const hash = await hashFile(filePath);
        const frontend = this.frontends!.forFile(filePath);
        if (frontend) {
          const content = await fs.readFile(filePath, "utf-8");
          const patch = await frontend.parseFile(filePath, content);

          allNodes.push(...patch.nodes);
          allEdges.push(...patch.edges);
          allFiles.push({
            path: filePath,
            hash,
            mtime: stat.mtimeMs,
            language: frontend.language,
            last_indexed_at: Date.now(),
          });
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`Error indexing ${filePath}:`, err);
        }
      } finally {
        current++;
        onProgress?.(current, total);
      }
    };

    for (let i = 0; i < filePaths.length; i += concurrency) {
      const chunk = filePaths.slice(i, i + concurrency);
      await Promise.all(chunk.map((fp) => processFile(fp)));
    }

    if (allFiles.length > 0 || deletedFiles.length > 0) {
      const releaseLock = await acquireLock(cwd);
      const db = getDb(archgraphDir);

      try {
        patchGraph(db, allFiles, allNodes, allEdges, deletedFiles);
        this.updateCentralityAndFiles(db);
        setGraphRevision(db, await this.buildRevision(cwd, allFiles.map((file) => file.hash ?? "")));
      } finally {
        db.close();
        await releaseLock();
      }
    }
  }

  private updateCentralityAndFiles(db: ReturnType<typeof getDb>): void {
    const analyzer = new GraphAnalyzer(db);
    const rankedNodes = analyzer.rankNodes();
    const fileTopologies = analyzer.analyzeFileTopology();

    const updateNodesByFile = db.prepare(`
      UPDATE nodes
      SET domain = ?, subsystem = ?, cluster_id = ?
      WHERE file_path = ?
    `);

    for (const file of fileTopologies) {
      updateNodesByFile.run(
        file.domain ?? "workspace",
        file.subsystem ?? file.domain ?? "workspace",
        file.cluster_id ?? `${file.domain ?? "workspace"}:${file.subsystem ?? file.domain ?? "workspace"}`,
        file.path
      );
    }

    const updateNodeCentrality = db.prepare(`
      UPDATE nodes
      SET centrality_score = ?
      WHERE id = ?
    `);

    for (const item of rankedNodes) {
      updateNodeCentrality.run(item.centrality, item.node.id);
    }

    const updateFile = db.prepare(`
      UPDATE files
      SET centrality_score = ?, domain = ?, subsystem = ?
      WHERE path = ?
    `);

    for (const file of fileTopologies) {
      updateFile.run(file.centrality, file.domain ?? "workspace", file.subsystem ?? file.domain ?? "workspace", file.path);
    }

    db.exec(`
      UPDATE files
      SET
        symbol_count = COALESCE(symbol_count, 0),
        edge_count = COALESCE(edge_count, 0),
        domain = COALESCE(domain, 'workspace'),
        subsystem = COALESCE(subsystem, domain, 'workspace'),
        centrality_score = COALESCE(centrality_score, 0)
    `);
  }

  private async buildRevision(cwd: string, fileHashes: string[]) {
    const indexedCommit = await this.resolveGitCommit(cwd);
    const indexedAt = Date.now();
    const workspaceId = hashString(cwd);
    const graphRevision = hashString(`${workspaceId}:${indexedCommit ?? "no-git"}:${indexedAt}:${fileHashes.sort().join(",")}`);
    return {
      graphRevision,
      indexedCommit,
      workspaceId,
      indexedAt,
    };
  }

  private async resolveGitCommit(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async getAllProjectFiles(dir: string): Promise<string[]> {
    const ig = ignore().add([".git", "node_modules", "dist", "build", ".pi/archgraph"]);
    try {
      const gitignoreContent = await fs.readFile(path.join(dir, ".gitignore"), "utf-8");
      ig.add(gitignoreContent);
    } catch {
      // ignore
    }

    const results: string[] = [];
    async function traverse(currentDir: string, relativePath: string) {
      try {
        const list = await fs.readdir(currentDir, { withFileTypes: true });
        for (const item of list) {
          const itemRelPath = path.join(relativePath, item.name);
          const itemAbsPath = path.join(currentDir, item.name);
          if (ig.ignores(itemRelPath.split(path.sep).join(path.posix.sep))) continue;
          if (item.isDirectory()) {
            await traverse(itemAbsPath, itemRelPath);
          } else if (item.isFile()) {
            results.push(itemAbsPath);
          }
        }
      } catch {
        // ignore read errors
      }
    }

    await traverse(dir, "");
    return results;
  }
}

export async function updateGraph(cwd: string, filesToUpdate?: string[], onProgress?: (current: number, total: number) => void) {
  const indexer = new WorkspaceIndexer();
  await indexer.updateGraph(cwd, filesToUpdate, onProgress);
}
