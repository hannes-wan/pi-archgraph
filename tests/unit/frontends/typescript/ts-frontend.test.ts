import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptFrontend } from '../../../../src/frontends/typescript/ts-frontend.js';
import { createTempDir, createTempFile, cleanupTempDir } from '../../../helpers/fs-helper.js';

describe('TypeScriptFrontend', () => {
  let frontend: TypeScriptFrontend;
  let tempDir: string;

  beforeEach(() => {
    frontend = new TypeScriptFrontend();
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('language', () => {
    it('should have typescript as language', () => {
      expect(frontend.language).toBe('typescript');
    });
  });

  describe('supports', () => {
    it('should support .ts files', () => {
      expect(frontend.supports('file.ts')).toBe(true);
      expect(frontend.supports('/path/to/file.ts')).toBe(true);
    });

    it('should support .tsx files', () => {
      expect(frontend.supports('component.tsx')).toBe(true);
      expect(frontend.supports('/path/to/component.tsx')).toBe(true);
    });

    it('should not support .js files', () => {
      expect(frontend.supports('file.js')).toBe(false);
    });

    it('should not support other extensions', () => {
      expect(frontend.supports('file.py')).toBe(false);
      expect(frontend.supports('file.ts.txt')).toBe(false);
    });
  });

  describe('parseFile - class extraction', () => {
    it('should extract exported classes', async () => {
      const filePath = createTempFile(tempDir, 'class-test.ts', `
        export class MyClass {
          name: string;
          greet() { return 'hello'; }
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const classNode = result.nodes.find(n => n.kind === 'class' && n.name === 'MyClass');
      expect(classNode).toBeDefined();
      expect(classNode?.qualified_name).toBe('MyClass');
      expect(classNode?.language).toBe('typescript');
    });

    it('should not extract non-exported classes', async () => {
      const filePath = createTempFile(tempDir, 'private-class.ts', `
        class PrivateClass {
          name: string;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const classNode = result.nodes.find(n => n.kind === 'class' && n.name === 'PrivateClass');
      expect(classNode).toBeUndefined();
    });

    it('should extract class methods with qualified names', async () => {
      const filePath = createTempFile(tempDir, 'methods.ts', `
        export class MyService {
          doSomething(): void {}
          private helper(): number { return 1; }
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const methodNodes = result.nodes.filter(n => n.kind === 'method');
      expect(methodNodes.length).toBeGreaterThanOrEqual(2);
      expect(methodNodes.some(m => m.qualified_name === 'MyService.doSomething')).toBe(true);
      expect(methodNodes.some(m => m.qualified_name === 'MyService.helper')).toBe(true);
    });

    it('should extract class properties with qualified names', async () => {
      const filePath = createTempFile(tempDir, 'properties.ts', `
        export class Config {
          apiUrl: string;
          timeout: number;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const propNodes = result.nodes.filter(n => n.kind === 'property');
      expect(propNodes.some(p => p.qualified_name === 'Config.apiUrl')).toBe(true);
      expect(propNodes.some(p => p.qualified_name === 'Config.timeout')).toBe(true);
    });

    it('should create contains edges for class members', async () => {
      const filePath = createTempFile(tempDir, 'edges.ts', `
        export class MyClass {
          myMethod(): void {}
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const containsEdges = result.edges.filter(e => e.kind === 'contains');
      expect(containsEdges.length).toBeGreaterThanOrEqual(2); // class + method
    });

    it('should create defines edges for class members', async () => {
      const filePath = createTempFile(tempDir, 'defines.ts', `
        export class MyClass {
          myMethod(): void {}
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const definesEdges = result.edges.filter(e => e.kind === 'defines');
      expect(definesEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('parseFile - function extraction', () => {
    it('should extract exported functions', async () => {
      const filePath = createTempFile(tempDir, 'functions.ts', `
        export function myFunction(): void {
          console.log('hello');
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const funcNode = result.nodes.find(n => n.kind === 'function' && n.name === 'myFunction');
      expect(funcNode).toBeDefined();
      expect(funcNode?.qualified_name).toBe('myFunction');
    });

    it('should not extract non-exported functions', async () => {
      const filePath = createTempFile(tempDir, 'private-function.ts', `
        function privateFunc(): void {}
      `);

      const result = await frontend.parseFile(filePath, '');

      const funcNode = result.nodes.find(n => n.kind === 'function');
      expect(funcNode).toBeUndefined();
    });
  });

  describe('parseFile - interface extraction', () => {
    it('should extract exported interfaces', async () => {
      const filePath = createTempFile(tempDir, 'interfaces.ts', `
        export interface User {
          id: number;
          name: string;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const interfaceNode = result.nodes.find(n => n.kind === 'interface' && n.name === 'User');
      expect(interfaceNode).toBeDefined();
      expect(interfaceNode?.qualified_name).toBe('User');
    });

    it('should extract interface methods with qualified names', async () => {
      const filePath = createTempFile(tempDir, 'interface-methods.ts', `
        export interface Greeter {
          greet(): string;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const methodNode = result.nodes.find(
        n => n.kind === 'method' && n.qualified_name === 'Greeter.greet'
      );
      expect(methodNode).toBeDefined();
    });

    it('should extract interface properties with qualified names', async () => {
      const filePath = createTempFile(tempDir, 'interface-props.ts', `
        export interface Config {
          debug: boolean;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const propNode = result.nodes.find(
        n => n.kind === 'property' && n.qualified_name === 'Config.debug'
      );
      expect(propNode).toBeDefined();
    });
  });

  describe('parseFile - type alias extraction', () => {
    it('should extract exported type aliases', async () => {
      const filePath = createTempFile(tempDir, 'types.ts', `
        export type ID = string | number;
      `);

      const result = await frontend.parseFile(filePath, '');

      const typeNode = result.nodes.find(n => n.kind === 'type' && n.name === 'ID');
      expect(typeNode).toBeDefined();
    });
  });

  describe('parseFile - enum extraction', () => {
    it('should extract exported enums', async () => {
      const filePath = createTempFile(tempDir, 'enums.ts', `
        export enum Status {
          Active,
          Inactive,
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const enumNode = result.nodes.find(n => n.kind === 'enum' && n.name === 'Status');
      expect(enumNode).toBeDefined();
      expect(enumNode?.qualified_name).toBe('Status');
    });

    it('should extract enum members with qualified names', async () => {
      const filePath = createTempFile(tempDir, 'enum-members.ts', `
        export enum Color {
          Red,
          Blue,
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const memberNodes = result.nodes.filter(n => n.kind === 'enum-member');
      expect(memberNodes.length).toBe(2);
      expect(memberNodes.some(m => m.qualified_name === 'Color.Red')).toBe(true);
      expect(memberNodes.some(m => m.qualified_name === 'Color.Blue')).toBe(true);
    });
  });

  describe('parseFile - file node', () => {
    it('should create a file node', async () => {
      const filePath = createTempFile(tempDir, 'empty.ts', '');

      const result = await frontend.parseFile(filePath, '');

      const fileNode = result.nodes.find(n => n.kind === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode?.name).toBe('empty.ts');
      expect(fileNode?.language).toBe('typescript');
    });

    it('should have contains edges from file to declarations', async () => {
      const filePath = createTempFile(tempDir, 'declarations.ts', `
        export class MyClass {}
      `);

      const result = await frontend.parseFile(filePath, '');

      const containsEdge = result.edges.find(
        e => e.kind === 'contains' && e.from_id.startsWith('file:')
      );
      expect(containsEdge).toBeDefined();
    });
  });

  describe('qualified_name generation', () => {
    it('should generate qualified_name for class members', async () => {
      const filePath = createTempFile(tempDir, 'qualified.ts', `
        export class Calculator {
          add(a: number, b: number): number { return a + b; }
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const methodNode = result.nodes.find(n => n.kind === 'method');
      expect(methodNode?.qualified_name).toMatch(/^Calculator\.\w+$/);
    });

    it('should generate qualified_name for interface members', async () => {
      const filePath = createTempFile(tempDir, 'qualified-interface.ts', `
        export interface Repository<T> {
          findById(id: string): T | null;
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const methodNode = result.nodes.find(n => n.kind === 'method');
      expect(methodNode?.qualified_name).toBe('Repository.findById');
    });

    it('should generate qualified_name for top-level functions', async () => {
      const filePath = createTempFile(tempDir, 'qualified-func.ts', `
        export function standalone() {}
      `);

      const result = await frontend.parseFile(filePath, '');

      const funcNode = result.nodes.find(n => n.kind === 'function');
      expect(funcNode?.qualified_name).toBe('standalone');
    });
  });

  describe('parseFile - variable extraction', () => {
    it('should extract exported variables', async () => {
      const filePath = createTempFile(tempDir, 'variables.ts', `
        export const MAX_RETRIES = 3;
      `);

      const result = await frontend.parseFile(filePath, '');

      const varNode = result.nodes.find(n => n.kind === 'variable' && n.name === 'MAX_RETRIES');
      expect(varNode).toBeDefined();
    });
  });

  describe('parseFile - node metadata', () => {
    it('should include file_path in nodes', async () => {
      const filePath = createTempFile(tempDir, 'metadata.ts', `
        export class Test {}
      `);

      const result = await frontend.parseFile(filePath, '');

      const classNode = result.nodes.find(n => n.kind === 'class');
      expect(classNode?.file_path).toBe(filePath);
    });

    it('should include start and end lines', async () => {
      const filePath = createTempFile(tempDir, 'lines.ts', `
        export class Test {
          method() {}
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      const classNode = result.nodes.find(n => n.kind === 'class');
      expect(classNode?.start_line).toBeGreaterThan(0);
      expect(classNode?.end_line).toBeGreaterThanOrEqual(classNode?.start_line ?? 0);
    });

    it('should include hash for class nodes', async () => {
      const filePath = createTempFile(tempDir, 'hash.ts', `
        export class Test {}
      `);

      const result = await frontend.parseFile(filePath, '');

      const classNode = result.nodes.find(n => n.kind === 'class');
      expect(classNode?.hash).toBeDefined();
      expect(typeof classNode?.hash).toBe('string');
    });
  });

  describe('parseFile - import target resolution', () => {
    it('should resolve aliased imports to the imported symbol in depends_on edges', async () => {
      const filePath = createTempFile(tempDir, 'import-alias.ts', `
        import { readFileSync as readFile } from 'node:fs';

        export function loadConfig() {
          return readFile('config.json', 'utf8');
        }
      `);

      const result = await frontend.parseFile(filePath, '');

      expect(result.edges.some((edge) => edge.kind === 'depends_on' && edge.to_id === 'node:fs::readFileSync')).toBe(true);
    });
  });

  describe('parseFile - empty file', () => {
    it('should handle empty file', async () => {
      const filePath = createTempFile(tempDir, 'empty.ts', '');

      const result = await frontend.parseFile(filePath, '');

      // Should still have the file node
      const fileNode = result.nodes.find(n => n.kind === 'file');
      expect(fileNode).toBeDefined();
      expect(result.nodes.length).toBe(1);
    });
  });
});
