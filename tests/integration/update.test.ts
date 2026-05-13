import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateGraph } from '../../src/core/workspace-indexer.js';
import { getDb } from '../../src/graph/db.js';
import { getArchgraphDir } from '../../src/util/paths.js';

describe('updateGraph Integration Tests', () => {
  let tempDir: string;
  let projectDir: string;
  let archgraphDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-update-test-'));
    projectDir = path.join(tempDir, 'project');
    archgraphDir = path.join(projectDir, '.pi', 'archgraph');
    
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020' } })
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should perform incremental update for single file', async () => {
    // Initial setup with two files
    await fs.writeFile(
      path.join(projectDir, 'src', 'a.ts'),
      `export function funcA() { return 1; }
export const valA = 'a';`
    );
    await fs.writeFile(
      path.join(projectDir, 'src', 'b.ts'),
      `export function funcB() { return 2; }`
    );

    // Initial index
    await updateGraph(projectDir);

    let db = getDb(archgraphDir);
    let nodes = db.prepare("SELECT name FROM nodes WHERE kind = 'function'").all() as { name: string }[];
    expect(nodes.map(n => n.name).sort()).toEqual(['funcA', 'funcB']);
    db.close();

    // Update only file a.ts
    await fs.writeFile(
      path.join(projectDir, 'src', 'a.ts'),
      `export function funcA() { return 100; }
export const valA = 'a';
export function newFunc() { return 999; }`
    );

    await updateGraph(projectDir, [path.join(projectDir, 'src', 'a.ts')]);

    // Verify both files are still indexed
    db = getDb(archgraphDir);
    nodes = db.prepare("SELECT name FROM nodes WHERE kind = 'function'").all() as { name: string }[];
    expect(nodes.map(n => n.name)).toContain('funcA');
    expect(nodes.map(n => n.name)).toContain('funcB');
    expect(nodes.map(n => n.name)).toContain('newFunc');
    db.close();
  });

  it('should update file hash on modification', async () => {
    const filePath = path.join(projectDir, 'src', 'test.ts');
    await fs.writeFile(filePath, 'export const x = 1;');

    await updateGraph(projectDir);

    const db1 = getDb(archgraphDir);
    const original = db1.prepare('SELECT hash FROM files WHERE path = ?').get(filePath) as { hash: string };
    const originalHash = original.hash;
    db1.close();

    // Wait a tiny bit and modify
    await new Promise(r => setTimeout(r, 10));
    await fs.writeFile(filePath, 'export const x = 2;');

    await updateGraph(projectDir, [filePath]);

    const db2 = getDb(archgraphDir);
    const updated = db2.prepare('SELECT hash FROM files WHERE path = ?').get(filePath) as { hash: string };
    expect(updated.hash).not.toBe(originalHash);
    db2.close();
  });

  it('should track dirty files correctly', async () => {
    const fileA = path.join(projectDir, 'src', 'a.ts');
    const fileB = path.join(projectDir, 'src', 'b.ts');

    await fs.writeFile(fileA, 'export const a = 1;');
    await fs.writeFile(fileB, 'export const b = 2;');

    await updateGraph(projectDir);

    // Modify file A
    await fs.writeFile(fileA, 'export const a = 100;');
    
    // Update only file A
    await updateGraph(projectDir, [fileA]);

    const db = getDb(archgraphDir);
    const files = db.prepare('SELECT path, hash FROM files').all();
    
    // Both files should still be tracked
    expect(files.length).toBe(2);
    expect((files as any[]).some(f => f.path === fileA)).toBe(true);
    expect((files as any[]).some(f => f.path === fileB)).toBe(true);
    db.close();
  });

  it('should add new files to existing graph', async () => {
    // Start with one file
    await fs.writeFile(
      path.join(projectDir, 'src', 'existing.ts'),
      'export function existing() { }'
    );

    await updateGraph(projectDir);

    let db = getDb(archgraphDir);
    let files = db.prepare('SELECT * FROM files').all();
    expect(files.length).toBe(1);
    db.close();

    // Add a new file
    const newFile = path.join(projectDir, 'src', 'new.ts');
    await fs.writeFile(newFile, 'export function brandNew() { }');

    await updateGraph(projectDir, [newFile]);

    db = getDb(archgraphDir);
    files = db.prepare('SELECT * FROM files').all();
    expect(files.length).toBe(2);
    expect((files as any[]).every((file) => typeof file.symbol_count === 'number')).toBe(true);
    
    const nodes = db.prepare("SELECT name FROM nodes WHERE kind = 'function'").all() as { name: string }[];
    expect(nodes.map(n => n.name)).toContain('existing');
    expect(nodes.map(n => n.name)).toContain('brandNew');
    db.close();
  });

  it('should handle multiple file updates', async () => {
    // Start with initial files
    await fs.writeFile(path.join(projectDir, 'src', 'a.ts'), 'export const a = 1;');
    await fs.writeFile(path.join(projectDir, 'src', 'b.ts'), 'export const b = 2;');
    await fs.writeFile(path.join(projectDir, 'src', 'c.ts'), 'export const c = 3;');

    await updateGraph(projectDir);

    // Update multiple files at once
    const fileA = path.join(projectDir, 'src', 'a.ts');
    const fileC = path.join(projectDir, 'src', 'c.ts');
    
    await fs.writeFile(fileA, 'export const a = 100;');
    await fs.writeFile(fileC, 'export const c = 300; export const newC = 333;');

    await updateGraph(projectDir, [fileA, fileC]);

    const db = getDb(archgraphDir);
    const nodes = db.prepare('SELECT name, kind FROM nodes').all() as { name: string; kind: string }[];
    
    // File B should be unchanged
    const fileBNode = nodes.find(n => n.name === 'b' && n.kind === 'variable');
    expect(fileBNode).toBeDefined();
    
    // File A and C should be updated
    const fileANode = nodes.find(n => n.name === 'a' && n.kind === 'variable');
    expect(fileANode).toBeDefined();
    
    // New symbol in file C should exist
    expect(nodes.some(n => n.name === 'newC')).toBe(true);
    db.close();
  });

  it('should preserve edges across updates', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `export class Service {
  private helper = new Helper();
  run() {
    return this.helper.work();
  }
}

class Helper {
  work() { return 'done'; }
}`
    );

    await updateGraph(projectDir);

    let db = getDb(archgraphDir);
    let edges = db.prepare('SELECT * FROM edges').all();
    expect(edges.length).toBeGreaterThan(0);
    db.close();

    // Update the file (slightly modify)
    await fs.writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `export class Service {
  private helper = new Helper();
  run() {
    return this.helper.work() + '!';
  }
}

class Helper {
  work() { return 'done'; }
}`
    );

    await updateGraph(projectDir, [path.join(projectDir, 'src', 'main.ts')]);

    db = getDb(archgraphDir);
    edges = db.prepare('SELECT * FROM edges').all();
    // Should still have edges
    expect(edges.length).toBeGreaterThan(0);
    expect((edges as any[]).some((edge) => edge.source_file !== null)).toBe(true);
    
    // Check for contains edges (at least 2: file->Service, file->Helper)
    const containsEdges = (edges as any[]).filter((e: any) => e.kind === 'contains');
    expect(containsEdges.length).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it('should update nodes from updated files only', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'stable.ts'),
      'export function stableFunc() { }'
    );
    await fs.writeFile(
      path.join(projectDir, 'src', 'changing.ts'),
      'export function changingFunc() { return 1; }'
    );

    await updateGraph(projectDir);

    const db1 = getDb(archgraphDir);
    const changingNode = db1.prepare('SELECT * FROM nodes WHERE name = ?').get('changingFunc') as any;
    const originalStartLine = changingNode.start_line;
    db1.close();

    // Update only changing.ts with more content (different line numbers)
    await fs.writeFile(
      path.join(projectDir, 'src', 'changing.ts'),
      `// Comment line 1
// Comment line 2
// Comment line 3
// Comment line 4
export function changingFunc() { return 1; }
`
    );

    await updateGraph(projectDir, [path.join(projectDir, 'src', 'changing.ts')]);

    const db2 = getDb(archgraphDir);
    const updatedNode = db2.prepare('SELECT * FROM nodes WHERE name = ?').get('changingFunc') as any;
    expect(updatedNode.start_line).toBeGreaterThan(originalStartLine);
    
    // Stable file should be unchanged
    const stableNode = db2.prepare('SELECT * FROM nodes WHERE name = ?').get('stableFunc') as any;
    expect(stableNode.start_line).toBe(1);
    db2.close();
  });

  it('should handle re-indexing same content (idempotent)', async () => {
    const filePath = path.join(projectDir, 'src', 'test.ts');
    const content = 'export const value = 42;';
    await fs.writeFile(filePath, content);

    await updateGraph(projectDir);

    const db1 = getDb(archgraphDir);
    const hash1 = (db1.prepare('SELECT hash FROM files WHERE path = ?').get(filePath) as any).hash;
    db1.close();

    // Update with same content
    await updateGraph(projectDir, [filePath]);

    const db2 = getDb(archgraphDir);
    const hash2 = (db2.prepare('SELECT hash FROM files WHERE path = ?').get(filePath) as any).hash;
    expect(hash2).toBe(hash1);
    const fileRecord = db2.prepare('SELECT centrality_score, domain FROM files WHERE path = ?').get(filePath) as any;
    expect(fileRecord.domain).toBeTruthy();
    db2.close();
  });
});
