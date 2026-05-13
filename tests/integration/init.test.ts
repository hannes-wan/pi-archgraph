import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateGraph } from '../../src/core/workspace-indexer.js';
import { getDb } from '../../src/graph/db.js';
import { getArchgraphDir } from '../../src/util/paths.js';

describe('initGraph Integration Tests', () => {
  let tempDir: string;
  let projectDir: string;
  let archgraphDir: string;

  beforeEach(async () => {
    // Create a temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-init-test-'));
    projectDir = path.join(tempDir, 'project');
    archgraphDir = path.join(projectDir, '.pi', 'archgraph');
    
    // Create project structure
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020' } })
    );
  });

  afterEach(async () => {
    // Cleanup
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should create database and meta.json on initGraph', async () => {
    // Create test source files
    await fs.writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `export class UserService {
  greet(name: string): string {
    return 'Hello, ' + name;
  }
}

export interface Config {
  port: number;
}

export function init() {
  console.log('init');
}
`
    );

    // Run init
    await updateGraph(projectDir);

    // Verify archgraph dir exists
    expect(await directoryExists(archgraphDir)).toBe(true);

    // Verify database file exists
    const dbPath = path.join(archgraphDir, 'graph.db');
    expect(await fileExists(dbPath)).toBe(true);

    // Verify database has correct schema
    const db = getDb(archgraphDir);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all() as { name: string }[];
    
    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toEqual(['docs', 'edges', 'files', 'graph_metadata', 'nodes']);

    const metadataKeys = db.prepare(`SELECT key FROM graph_metadata`).all() as Array<{ key: string }>;
    expect(metadataKeys.map((row) => row.key).sort()).toEqual([
      'graphRevision',
      'indexedAt',
      'indexedCommit',
      'workspaceId',
    ]);
    
    db.close();
  });

  it('should index multiple TypeScript files', async () => {
    // Create multiple source files
    await fs.writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `export class App {
  run() { }
}

export function start() { }
`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'utils.ts'),
      `export interface Logger {
  log(msg: string): void;
}

export class ConsoleLogger implements Logger {
  log(msg: string) {
    console.log(msg);
  }
}
`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'types.ts'),
      `export type Result<T> = { success: true; data: T } | { success: false; error: string };
export type Status = 'pending' | 'running' | 'done';
`
    );

    // Run init
    await updateGraph(projectDir);

    // Verify nodes were created
    const db = getDb(archgraphDir);
    const nodes = db.prepare('SELECT * FROM nodes').all();
    const edges = db.prepare('SELECT * FROM edges').all();
    const files = db.prepare('SELECT * FROM files').all();
    
    // Should have 3 file nodes + multiple exported symbols
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(edges.length).toBeGreaterThanOrEqual(3);
    expect(files.length).toBe(3);
    expect((files as any[]).every((file) => typeof file.domain === 'string' || file.domain === null)).toBe(true);
    
    db.close();
  });

  it('should correctly index class with methods', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'service.ts'),
      `export class OrderService {
  private orders: Map<string, number> = new Map();
  
  addOrder(id: string, amount: number): void {
    this.orders.set(id, amount);
  }
  
  getTotal(): number {
    return Array.from(this.orders.values()).reduce((a, b) => a + b, 0);
  }
}
`
    );

    await updateGraph(projectDir);

    const db = getDb(archgraphDir);
    const nodes = db.prepare(`
      SELECT id, kind, name FROM nodes 
      WHERE file_path LIKE '%service.ts%'
      ORDER BY kind
    `).all() as { id: string; kind: string; name: string }[];

    // Should have file node, class node, and method nodes
    expect(nodes.some(n => n.kind === 'file')).toBe(true);
    expect(nodes.some(n => n.kind === 'class' && n.name === 'OrderService')).toBe(true);
    expect(nodes.some(n => n.kind === 'method' && n.name.includes('addOrder'))).toBe(true);
    expect(nodes.some(n => n.kind === 'method' && n.name.includes('getTotal'))).toBe(true);
    
    // Check for defines edges between class and methods (addOrder, getTotal, plus constructor)
    const definesEdges = db.prepare(`
      SELECT * FROM edges WHERE kind = 'defines'
    `).all();
    expect(definesEdges.length).toBe(3);

    const sourcefulEdges = db.prepare(`
      SELECT * FROM edges WHERE source_file IS NOT NULL
    `).all();
    expect(sourcefulEdges.length).toBeGreaterThan(0);
    
    db.close();
  });

  it('should create nodes with correct properties', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'model.ts'),
      `export interface User {
  id: number;
  name: string;
  email: string;
}
`
    );

    await updateGraph(projectDir);

    const db = getDb(archgraphDir);
    const interfaceNode = db.prepare(`
      SELECT * FROM nodes WHERE kind = 'interface' AND name = 'User'
    `).get() as any;

    expect(interfaceNode).toBeDefined();
    expect(interfaceNode.kind).toBe('interface');
    expect(interfaceNode.name).toBe('User');
    expect(interfaceNode.file_path).toContain('model.ts');
    expect(interfaceNode.start_line).toBeGreaterThan(0);
    expect(interfaceNode.end_line).toBeGreaterThan(interfaceNode.start_line);
    expect(interfaceNode.hash).toBeTruthy();
    expect(interfaceNode.domain).toBeTruthy();
    expect(interfaceNode.cluster_id).toBeTruthy();
    
    db.close();
  });

  it('should handle empty src directory gracefully', async () => {
    // Run init on project with empty src
    await updateGraph(projectDir);

    // Should still create archgraph dir and database
    expect(await directoryExists(archgraphDir)).toBe(true);
    const dbPath = path.join(archgraphDir, 'graph.db');
    expect(await fileExists(dbPath)).toBe(true);

    // Database should be empty
    const db = getDb(archgraphDir);
    const nodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
    expect(nodes.count).toBe(0);
    db.close();
  });

  it('should handle project without tsconfig.json', async () => {
    // Remove tsconfig.json
    await fs.unlink(path.join(projectDir, 'tsconfig.json'));

    await fs.writeFile(
      path.join(projectDir, 'src', 'simple.ts'),
      `export const x = 1;
`
    );

    // Should still work
    await updateGraph(projectDir);

    expect(await directoryExists(archgraphDir)).toBe(true);
    const db = getDb(archgraphDir);
    const nodes = db.prepare('SELECT * FROM nodes').all();
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    db.close();
  });
});

// Helper functions
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
