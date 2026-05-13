import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, SCHEMA_SQL, type GraphNode, type GraphEdge } from '../../../src/graph/db.js';

describe('Graph DB', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'archgraph-test-'));
  const dbPath = path.join(tempDir, 'graph.db');

  beforeEach(() => {
    // Ensure directory exists
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getDb', () => {
    it('creates database file', () => {
      const db = getDb(tempDir);
      expect(fs.existsSync(dbPath)).toBe(true);
      db.close();
    });

    it('creates tables', () => {
      const db = getDb(tempDir);
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
      const tableNames = tables.map((t: any) => t.name);
      expect(tableNames).toContain('nodes');
      expect(tableNames).toContain('edges');
      expect(tableNames).toContain('files');
      expect(tableNames).toContain('docs');
      expect(tableNames).toContain('graph_metadata');
      db.close();
    });

    it('creates architecture columns', () => {
      const db = getDb(tempDir);
      const nodeColumns = db.pragma('table_info(nodes)').map((c: any) => c.name);
      const edgeColumns = db.pragma('table_info(edges)').map((c: any) => c.name);
      const fileColumns = db.pragma('table_info(files)').map((c: any) => c.name);
      expect(nodeColumns).toContain('language');
      expect(nodeColumns).toContain('qualified_name');
      expect(nodeColumns).toContain('domain');
      expect(nodeColumns).toContain('cluster_id');
      expect(edgeColumns).toContain('source_file');
      expect(edgeColumns).toContain('source_start_line');
      expect(fileColumns).toContain('symbol_count');
      expect(fileColumns).toContain('centrality_score');
      db.close();
    });

    it('creates indexes', () => {
      const db = getDb(tempDir);
      const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all();
      const indexNames = indexes.map((i: any) => i.name);
      expect(indexNames).toContain('idx_nodes_language');
      expect(indexNames).toContain('idx_nodes_qualified_name');
      expect(indexNames).toContain('idx_edges_kind');
      expect(indexNames).toContain('idx_files_domain');
      db.close();
    });

    it('creates indexes on existing db (migration)', () => {
      // First open without indexes
      const db1 = getDb(tempDir);
      const cols1 = db1.pragma('table_info(nodes)');
      db1.close();

      // Reopen - should add indexes
      const db2 = getDb(tempDir);
      const indexes = db2.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all();
      const indexNames = indexes.map((i: any) => i.name);
      expect(indexNames).toContain('idx_nodes_language');
      db2.close();
    });
  });

  describe('GraphNode type', () => {
    it('accepts V2 fields', () => {
      const node: GraphNode = {
        id: 'test',
        language: 'typescript',
        kind: 'class',
        name: 'TestClass',
        qualified_name: 'TestClass',
        file_path: '/test.ts',
        start_line: 1,
        end_line: 10,
        hash: 'abc123',
        summary: 'Test summary',
        metadata_json: null,
        domain: 'graph',
        subsystem: 'src/graph',
        cluster_id: 'graph:src/graph',
        centrality_score: 10,
      };
      expect(node.language).toBe('typescript');
      expect(node.qualified_name).toBe('TestClass');
    });

    it('allows null for optional fields', () => {
      const node: GraphNode = {
        id: 'test',
        kind: 'class',
        name: 'TestClass',
        file_path: null,
        start_line: null,
        end_line: null,
        hash: null,
        summary: null,
        metadata_json: null,
      };
      expect(node.language).toBeUndefined();
      expect(node.file_path).toBeNull();
    });
  });
});
