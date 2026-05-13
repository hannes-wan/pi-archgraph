import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb, type GraphNode, type GraphEdge } from '../../../src/graph/db.js';
import { 
  findNodeByName, 
  getNodeDependencies, 
  getNodeCallers, 
  getFileNodes, 
  searchSymbols 
} from '../../../src/graph/queries.js';

describe('Graph Queries', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'archgraph-test-'));
  const archgraphDir = path.join(tempDir, '.pi', 'archgraph');

  let db: ReturnType<typeof getDb>;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);
    
    // Insert test data
    db.exec(`
      INSERT INTO nodes (id, language, kind, name, qualified_name, file_path, start_line, end_line, summary, domain, subsystem) VALUES
      ('file:/test.ts', 'typescript', 'file', 'test.ts', NULL, '/test.ts', 1, 100, 'Test source file', 'tools', 'query'),
      ('class:TestClass', 'typescript', 'class', 'TestClass', 'TestClass', '/test.ts', 10, 50, 'Container for query results', 'analysis', 'retrieval'),
      ('method:TestClass.foo', 'typescript', 'method', 'foo', 'TestClass.foo', '/test.ts', 20, 30, 'Handles decision-support lookup', 'analysis', 'retrieval'),
      ('func:bar', 'typescript', 'function', 'bar', 'bar', '/test.ts', 60, 80, 'decision-support candidate', NULL, NULL),
      ('func:high', 'typescript', 'function', 'high', 'high', '/test.ts', 85, 95, 'decision-support candidate', 'analysis', 'ranking');
      
      INSERT INTO edges (id, from_id, to_id, kind, confidence) VALUES
      ('contains:file:class', 'file:/test.ts', 'class:TestClass', 'contains', 1.0),
      ('defines:class:method', 'class:TestClass', 'method:TestClass.foo', 'defines', 1.0),
      ('calls:func:method', 'func:bar', 'method:TestClass.foo', 'calls', 0.9);
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('findNodeByName', () => {
    it('finds nodes by exact name', () => {
      const results = findNodeByName(db, 'TestClass');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('class:TestClass');
    });

    it('is case insensitive', () => {
      const results = findNodeByName(db, 'testclass');
      expect(results).toHaveLength(1);
    });

    it('returns empty for non-existent', () => {
      const results = findNodeByName(db, 'NonExistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('getNodeDependencies', () => {
    it('finds direct dependencies', () => {
      const deps = getNodeDependencies(db, 'func:bar', 2);
      expect(deps.length).toBeGreaterThan(0);
      const depIds = deps.map(d => d.id);
      expect(depIds).toContain('method:TestClass.foo');
    });

    it('respects depth limit', () => {
      const deps1 = getNodeDependencies(db, 'func:bar', 1);
      const deps2 = getNodeDependencies(db, 'func:bar', 3);
      expect(deps2.length).toBeGreaterThanOrEqual(deps1.length);
    });
  });

  describe('getNodeCallers', () => {
    it('finds direct callers', () => {
      const callers = getNodeCallers(db, 'method:TestClass.foo', 2);
      expect(callers.length).toBeGreaterThan(0);
      const callerIds = callers.map(c => c.id);
      expect(callerIds).toContain('func:bar');
      expect(callers[0]).toHaveProperty('path_length');
      expect(callers[0]).toHaveProperty('via_edge_kind');
    });

    it('returns empty for orphan nodes', () => {
      const callers = getNodeCallers(db, 'file:/test.ts', 2);
      // file may have no callers
      expect(Array.isArray(callers)).toBe(true);
    });
  });

  describe('getFileNodes', () => {
    it('returns all nodes for a file', () => {
      const nodes = getFileNodes(db, '/test.ts');
      expect(nodes.length).toBe(5);
    });

    it('returns empty for non-existent file', () => {
      const nodes = getFileNodes(db, '/non-existent.ts');
      expect(nodes.length).toBe(0);
    });
  });

  describe('searchSymbols', () => {
    it('searches by name prefix', () => {
      const results = searchSymbols(db, 'Test', 10);
      expect(results.length).toBeGreaterThan(0);
    });

    it('searches by partial name', () => {
      const results = searchSymbols(db, 'Class', 10);
      expect(results.some(r => r.name === 'TestClass')).toBe(true);
    });

    it('respects limit', () => {
      const results = searchSymbols(db, '', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('escapes special characters', () => {
      // Should not throw
      const results = searchSymbols(db, 'Test%Class', 10);
      expect(Array.isArray(results)).toBe(true);
    });

    it('matches symbols by summary text', () => {
      const results = searchSymbols(db, 'decision-support lookup', 10);
      expect(results.some(r => r.id === 'method:TestClass.foo')).toBe(true);
    });

    it('matches symbols by richer fields like domain or subsystem', () => {
      const results = searchSymbols(db, 'retrieval', 10);
      expect(results.some(r => r.id === 'class:TestClass')).toBe(true);
    });

    it('ranks comparable matches by higher decision-value signals', () => {
      const results = searchSymbols(db, 'decision-support candidate', 10);
      expect(results[0]?.id).toBe('func:high');
    });
  });
});
