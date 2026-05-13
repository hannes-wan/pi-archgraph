import { describe, it, expect } from 'vitest';
import type { LanguageFrontend, GraphPatch } from '../../../src/frontends/frontend.js';

describe('LanguageFrontend', () => {
  it('should be a valid interface type', () => {
    // Test that a mock implementation satisfies the interface
    const mockFrontend: LanguageFrontend = {
      language: 'test',
      supports: (path: string) => path.endsWith('.test'),
      parseFile: async (path: string, content: string) => ({ nodes: [], edges: [] }),
    };

    expect(mockFrontend.language).toBe('test');
    expect(mockFrontend.supports('foo.test')).toBe(true);
    expect(mockFrontend.supports('foo.other')).toBe(false);
  });

  it('should support method signature with path string', () => {
    const mockFrontend: LanguageFrontend = {
      language: 'test',
      supports: (path: string) => path.endsWith('.ts'),
      parseFile: async (path: string, content: string) => ({ nodes: [], edges: [] }),
    };

    expect(mockFrontend.supports('/some/path/file.ts')).toBe(true);
    expect(mockFrontend.supports('file.js')).toBe(false);
  });

  it('should support parseFile returning GraphPatch', async () => {
    const mockFrontend: LanguageFrontend = {
      language: 'test',
      supports: () => true,
      parseFile: async (path: string, content: string) => ({
        nodes: [],
        edges: [],
      }),
    };

    const result = await mockFrontend.parseFile('test.ts', 'const x = 1');
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });
});

describe('GraphPatch', () => {
  it('should have correct structure', () => {
    const patch: GraphPatch = {
      nodes: [],
      edges: [],
    };

    expect(patch).toHaveProperty('nodes');
    expect(patch).toHaveProperty('edges');
  });

  it('should contain node and edge arrays', () => {
    const patch: GraphPatch = {
      nodes: [
        {
          id: 'file:test.ts',
          language: 'typescript',
          kind: 'file',
          name: 'test.ts',
          qualified_name: null,
          file_path: '/test.ts',
          start_line: 1,
          end_line: 10,
          hash: null,
          summary: null,
          metadata_json: null,
        },
      ],
      edges: [
        {
          id: 'contains:file:test.ts:class:test.ts:MyClass',
          from_id: 'file:test.ts',
          to_id: 'class:test.ts:MyClass',
          kind: 'contains',
          confidence: 1.0,
          metadata_json: null,
        },
      ],
    };

    expect(patch.nodes).toHaveLength(1);
    expect(patch.edges).toHaveLength(1);
    expect(patch.nodes[0].kind).toBe('file');
    expect(patch.edges[0].kind).toBe('contains');
  });
});
