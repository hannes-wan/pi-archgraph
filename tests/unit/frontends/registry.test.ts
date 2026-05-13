import { describe, it, expect, beforeEach } from 'vitest';
import { FrontendRegistry } from '../../../src/frontends/registry.js';
import type { LanguageFrontend } from '../../../src/frontends/frontend.js';
import { CFrontend } from '../../../src/frontends/c/c-frontend.js';
import { CppFrontend } from '../../../src/frontends/cpp/cpp-frontend.js';

describe('FrontendRegistry', () => {
  let registry: FrontendRegistry;

  beforeEach(() => {
    registry = new FrontendRegistry();
  });

  const createMockFrontend = (language: string): LanguageFrontend => ({
    language,
    supports: (path: string) => path.includes(`.${language}`),
    parseFile: async (path: string, content: string) => ({ nodes: [], edges: [] }),
  });

  describe('register', () => {
    it('should register a frontend', () => {
      const frontend = createMockFrontend('typescript');
      registry.register(frontend);
      expect(registry.get('typescript')).toBe(frontend);
    });

    it('should allow registering multiple frontends', () => {
      const tsFrontend = createMockFrontend('typescript');
      const jsFrontend = createMockFrontend('javascript');
      registry.register(tsFrontend);
      registry.register(jsFrontend);

      expect(registry.get('typescript')).toBe(tsFrontend);
      expect(registry.get('javascript')).toBe(jsFrontend);
    });

    it('should overwrite existing frontend with same language', () => {
      const frontend1 = createMockFrontend('typescript');
      const frontend2 = createMockFrontend('typescript');
      frontend2.supports = () => false; // Different behavior

      registry.register(frontend1);
      registry.register(frontend2);

      expect(registry.get('typescript')).toBe(frontend2);
      expect(registry.get('typescript')?.supports('test.ts')).toBe(false);
    });
  });

  describe('get', () => {
    it('should retrieve a registered frontend by language', () => {
      const frontend = createMockFrontend('rust');
      registry.register(frontend);
      expect(registry.get('rust')).toBe(frontend);
    });

    it('should return undefined for unregistered language', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('should return undefined for empty registry', () => {
      expect(registry.get('typescript')).toBeUndefined();
    });
  });

  describe('forFile', () => {
    it('should find frontend for TypeScript file', () => {
      const tsFrontend = createMockFrontend('typescript');
      registry.register(tsFrontend);
      expect(registry.forFile('file.ts')).toBe(tsFrontend);
    });

    it('should find frontend for TypeScriptX file', () => {
      const tsFrontend = createMockFrontend('typescript');
      registry.register(tsFrontend);
      expect(registry.forFile('component.tsx')).toBe(tsFrontend);
    });

    it('should find frontend for JavaScript file', () => {
      const jsFrontend = createMockFrontend('javascript');
      registry.register(jsFrontend);
      expect(registry.forFile('file.js')).toBe(jsFrontend);
    });

    it('should find frontend for Python file', () => {
      const pyFrontend = createMockFrontend('python');
      registry.register(pyFrontend);
      expect(registry.forFile('script.py')).toBe(pyFrontend);
    });

    it('should return undefined for unsupported file', () => {
      const tsFrontend = createMockFrontend('typescript');
      registry.register(tsFrontend);
      expect(registry.forFile('file.txt')).toBeUndefined();
    });

    it('should return undefined when no frontend registered for language', () => {
      const tsFrontend = createMockFrontend('typescript');
      registry.register(tsFrontend);
      expect(registry.forFile('file.py')).toBeUndefined();
    });

    it('should return undefined for file without extension', () => {
      expect(registry.forFile('Makefile')).toBeUndefined();
    });

    it('should route C headers to the C frontend instead of C++', () => {
      const cppFrontend = new CppFrontend();
      const cFrontend = new CFrontend();

      registry.register(cppFrontend);
      registry.register(cFrontend);

      expect(registry.forFile('/tmp/src/c/shapes.h')).toBe(cFrontend);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getSupportedLanguages()).toEqual([]);
    });

    it('should return registered languages', () => {
      const tsFrontend = createMockFrontend('typescript');
      const jsFrontend = createMockFrontend('javascript');
      const rustFrontend = createMockFrontend('rust');

      registry.register(tsFrontend);
      registry.register(jsFrontend);
      registry.register(rustFrontend);

      const languages = registry.getSupportedLanguages();
      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toContain('rust');
      expect(languages).toHaveLength(3);
    });

    it('should not return duplicate languages', () => {
      const frontend = createMockFrontend('typescript');
      registry.register(frontend);
      registry.register(frontend);

      expect(registry.getSupportedLanguages()).toEqual(['typescript']);
    });
  });

  describe('integration', () => {
    it('should work as a complete frontend system', () => {
      const tsFrontend = createMockFrontend('typescript');
      const jsFrontend = createMockFrontend('javascript');

      registry.register(tsFrontend);
      registry.register(jsFrontend);

      // All languages registered
      expect(registry.getSupportedLanguages()).toContain('typescript');
      expect(registry.getSupportedLanguages()).toContain('javascript');

      // Can find frontend for file
      expect(registry.forFile('test.ts')).toBe(tsFrontend);
      expect(registry.forFile('test.js')).toBe(jsFrontend);

      // Can get frontend directly
      expect(registry.get('typescript')).toBe(tsFrontend);
    });
  });
});
