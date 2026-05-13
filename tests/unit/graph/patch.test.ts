import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb } from '../../../src/graph/db.js';
import { type GraphNode, type GraphEdge, type GraphFile } from '../../../src/graph/schema.js';
import { patchGraph } from '../../../src/graph/patch.js';

describe('Graph Patch', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'archgraph-test-'));
  const archgraphDir = path.join(tempDir, '.pi', 'archgraph');
  let db: ReturnType<typeof getDb>;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('patchGraph', () => {
    it('inserts files', () => {
      const files: GraphFile[] = [{
        path: '/test.ts',
        hash: 'abc123',
        mtime: Date.now(),
        language: 'typescript',
        last_indexed_at: Date.now(),
      }];

      patchGraph(db, files, [], []);

      const result = db.prepare('SELECT * FROM files WHERE path = ?').get('/test.ts') as any;
      expect(result.path).toBe('/test.ts');
      expect(result.language).toBe('typescript');
    });

    it('inserts nodes', () => {
      const nodes: GraphNode[] = [{
        id: 'class:Test',
        language: 'typescript',
        kind: 'class',
        name: 'Test',
        qualified_name: 'Test',
        file_path: '/test.ts',
        start_line: 1,
        end_line: 10,
        hash: null,
        summary: null,
        metadata_json: null,
      }];

      patchGraph(db, [], nodes, []);

      const result = db.prepare('SELECT * FROM nodes WHERE id = ?').get('class:Test') as any;
      expect(result.id).toBe('class:Test');
      expect(result.kind).toBe('class');
    });

    it('inserts edges', () => {
      const nodes: GraphNode[] = [{
        id: 'class:Test',
        language: 'typescript',
        kind: 'class',
        name: 'Test',
        qualified_name: 'Test',
        file_path: '/test.ts',
        start_line: 1,
        end_line: 10,
        hash: null,
        summary: null,
        metadata_json: null,
      }];

      const edges: GraphEdge[] = [{
        id: 'contains:file:class',
        from_id: 'file:/test.ts',
        to_id: 'class:Test',
        kind: 'contains',
        confidence: 1.0,
        metadata_json: null,
      }];

      patchGraph(db, [], nodes, edges);

      const result = db.prepare('SELECT * FROM edges WHERE id = ?').get('contains:file:class') as any;
      expect(result.kind).toBe('contains');
    });

    it('updates existing nodes (upsert)', () => {
      const node: GraphNode = {
        id: 'class:Test',
        language: 'typescript',
        kind: 'class',
        name: 'Test',
        qualified_name: 'Test',
        file_path: '/test.ts',
        start_line: 1,
        end_line: 10,
        hash: null,
        summary: null,
        metadata_json: null,
      };

      patchGraph(db, [], [node], []);
      patchGraph(db, [], [{ ...node, name: 'TestRenamed' }], []);

      const result = db.prepare('SELECT * FROM nodes WHERE id = ?').get('class:Test') as any;
      expect(result.name).toBe('TestRenamed');
    });

    it('removes deleted files', () => {
      patchGraph(db, [{ path: '/test.ts', hash: null, mtime: null, language: 'ts', last_indexed_at: null }], [], []);
      patchGraph(db, [], [], [], ['/test.ts']);

      const result = db.prepare('SELECT * FROM files WHERE path = ?').get('/test.ts');
      expect(result).toBeUndefined();
    });

    it('preserves unresolved (orphaned) edges', () => {
      // Insert edge with non-existent target (simulating unresolved call)
      db.exec(`
        INSERT INTO edges (id, from_id, to_id, kind, confidence)
        VALUES ('unresolved:edge', 'class:A', 'class:B', 'calls', 1.0)
      `);

      patchGraph(db, [], [], []); // No nodes, but edge should be preserved for late resolution

      const result = db.prepare('SELECT * FROM edges WHERE id = ?').get('unresolved:edge') as any;
      expect(result).toBeDefined();
      expect(result.id).toBe('unresolved:edge');
    });

    it('resolves string symbol targets to existing nodes during patching', () => {
      const nodes: GraphNode[] = [
        {
          id: 'class:/a.h:SessionCoordinator',
          language: 'cpp',
          kind: 'class',
          name: 'SessionCoordinator',
          qualified_name: 'SessionCoordinator',
          file_path: '/a.h',
          start_line: 1,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
        {
          id: 'class:/auth.h:AuthService',
          language: 'cpp',
          kind: 'class',
          name: 'AuthService',
          qualified_name: 'AuthService',
          file_path: '/auth.h',
          start_line: 1,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
      ];

      const edges: GraphEdge[] = [{
        id: 'depends_on:test',
        from_id: 'class:/a.h:SessionCoordinator',
        to_id: 'AuthService',
        kind: 'depends_on',
        confidence: 0.9,
        metadata_json: null,
        source_file: '/a.h',
        source_start_line: 2,
        source_end_line: 2,
      }];

      patchGraph(db, [], nodes, edges);

      const result = db.prepare('SELECT * FROM edges WHERE id = ?').get('depends_on:test') as any;
      expect(result.to_id).toBe('class:/auth.h:AuthService');
    });

    it('resolves include-like targets to file nodes during patching', () => {
      const files: GraphFile[] = [
        { path: '/tmp/include/ApiBindings.h', hash: null, mtime: null, language: 'cpp', last_indexed_at: null },
      ];
      const nodes: GraphNode[] = [{
        id: 'file:/tmp/include/ApiBindings.h',
        language: 'cpp',
        kind: 'file',
        name: 'ApiBindings.h',
        qualified_name: null,
        file_path: '/tmp/include/ApiBindings.h',
        start_line: 1,
        end_line: 1,
        hash: null,
        summary: null,
        metadata_json: null,
      }];
      const edges: GraphEdge[] = [{
        id: 'imports:test',
        from_id: 'file:/tmp/src/Client.h',
        to_id: 'ApiBindings.h',
        kind: 'imports',
        confidence: 1.0,
        metadata_json: null,
        source_file: '/tmp/src/Client.h',
        source_start_line: 1,
        source_end_line: 1,
      }];

      patchGraph(db, files, nodes, edges);

      const result = db.prepare('SELECT * FROM edges WHERE id = ?').get('imports:test') as any;
      expect(result.to_id).toBe('file:/tmp/include/ApiBindings.h');
    });
  });
});
