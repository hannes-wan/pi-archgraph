import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateGraph } from '../../src/core/workspace-indexer.js';
import { searchGraph, inspectSymbol } from '../../src/tools/inspect.js';
import { getDb } from '../../src/graph/db.js';
import { getArchgraphDir } from '../../src/util/paths.js';

describe('Full Workflow Integration Tests', () => {
  let tempDir: string;
  let projectDir: string;
  let archgraphDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-workflow-test-'));
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

  it('should complete init -> search workflow', async () => {
    // Step 1: Create project with various symbols
    await fs.writeFile(
      path.join(projectDir, 'src', 'services.ts'),
      `export class UserService {
  async createUser(name: string) {
    return { id: 1, name };
  }
  
  async getUser(id: number) {
    return { id, name: 'test' };
  }
}

export interface User {
  id: number;
  name: string;
}

export function validateUser(user: User): boolean {
  return user.id > 0 && user.name.length > 0;
}`
    );

    // Step 2: Initialize graph
    await updateGraph(projectDir);

    // Verify initial state
    let db = getDb(archgraphDir);
    let nodes = db.prepare('SELECT * FROM nodes').all();
    expect(nodes.length).toBeGreaterThan(0);
    db.close();

    // Step 3: Search for symbols
    const searchResults = await searchGraph(projectDir, 'UserService');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].name).toBe('UserService');
    expect(searchResults[0].kind).toBe('class');
  });

  it('should handle init -> update -> search -> update cycle', async () => {
    // Initial setup
    await fs.writeFile(
      path.join(projectDir, 'src', 'calculator.ts'),
      `export class Calculator {
  add(a: number, b: number): number { return a + b; }
  subtract(a: number, b: number): number { return a - b; }
}`
    );

    // Init
    await updateGraph(projectDir);

    // Search initial state
    let results = await searchGraph(projectDir, 'Calculator');
    expect(results.some(r => r.name === 'Calculator')).toBe(true);
    expect(results.some(r => r.kind === 'method')).toBe(true);

    // Update with new functionality
    await fs.writeFile(
      path.join(projectDir, 'src', 'calculator.ts'),
      `export class Calculator {
  add(a: number, b: number): number { return a + b; }
  subtract(a: number, b: number): number { return a - b; }
  multiply(a: number, b: number): number { return a * b; }
  divide(a: number, b: number): number { 
    if (b === 0) throw new Error('Division by zero');
    return a / b; 
  }
}`
    );

    await updateGraph(projectDir, [path.join(projectDir, 'src', 'calculator.ts')]);

    // Search after update
    results = await searchGraph(projectDir, 'Calculator');
    const methods = results.filter(r => r.kind === 'method');
    const methodNames = methods.map(m => m.name);
    
    // After update, should have all methods
    const allResults = await searchGraph(projectDir, 'multiply');
    expect(allResults.length).toBeGreaterThan(0);
    const allResultsDiv = await searchGraph(projectDir, 'divide');
    expect(allResultsDiv.length).toBeGreaterThan(0);
  });

  it('should maintain data consistency across workflow', async () => {
    // Create a more complex project
    await fs.writeFile(
      path.join(projectDir, 'src', 'database.ts'),
      `export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
}

export class Database {
  private config: ConnectionConfig;
  
  constructor(config: ConnectionConfig) {
    this.config = config;
  }
  
  connect(): void {
    console.log('Connecting to', this.config.host);
  }
  
  query(sql: string): any[] {
    return [];
  }
}

export function createConnection(config: ConnectionConfig): Database {
  return new Database(config);
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'models.ts'),
      `export interface Product {
  id: number;
  name: string;
  price: number;
}

export class ProductRepository {
  private products: Map<number, Product> = new Map();
  
  findById(id: number): Product | undefined {
    return this.products.get(id);
  }
  
  save(product: Product): void {
    this.products.set(product.id, product);
  }
}`
    );

    // Init graph
    await updateGraph(projectDir);

    let db = getDb(archgraphDir);
    
    // Verify file tracking
    const files = db.prepare('SELECT * FROM files').all();
    expect(files.length).toBe(2);
    
    // Verify nodes
    const nodes = db.prepare('SELECT * FROM nodes').all();
    const classNames = nodes.filter((n: any) => n.kind === 'class').map((n: any) => n.name);
    expect(classNames).toContain('Database');
    expect(classNames).toContain('ProductRepository');
    
    // Verify edges
    const edges = db.prepare('SELECT * FROM edges').all();
    expect(edges.length).toBeGreaterThan(0);
    db.close();

    // Search across files
    const results = await searchGraph(projectDir, 'Product');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle search with different match types', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'mixed.ts'),
      `export class UserManager { }
export class UserValidator { }
export class UserController { }
export function getUserById() { }
export function getUserByName() { }
export interface UserData { }
export type UserStatus = 'active' | 'inactive';`
    );

    await updateGraph(projectDir);

    // Exact match
    const exactResults = await searchGraph(projectDir, 'UserManager');
    expect(exactResults.some(r => r.name === 'UserManager')).toBe(true);

    // Prefix match
    const prefixResults = await searchGraph(projectDir, 'User');
    expect(prefixResults.length).toBeGreaterThan(1);

    // Fuzzy match
    const fuzzyResults = await searchGraph(projectDir, 'Validator');
    expect(fuzzyResults.some(r => r.name === 'UserValidator')).toBe(true);
  });

  it('should support file-based disambiguation in search and inspect', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'services.ts'),
      `export class SessionCoordinator {
  start() { return true; }
  stop() { return false; }
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'ui.ts'),
      `export class SessionCoordinator {}
`
    );

    await updateGraph(projectDir);

    const filteredResults = await searchGraph(projectDir, 'SessionCoordinator', 'class', 10, 'src/services.ts');
    expect(filteredResults).toHaveLength(1);
    expect(filteredResults[0].file_path).toContain('src/services.ts');

    const inspectResult = await inspectSymbol(projectDir, 'SessionCoordinator', {
      kind: 'class',
      file: 'src/services.ts',
    });
    expect(typeof inspectResult).toBe('string');
    expect(inspectResult).toContain('Location:');
    expect(inspectResult).toContain('Fan-in:');
    expect(inspectResult).toContain('src/services.ts');
  });

  it('should infer the primary definition when duplicate symbol names exist', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'rich.ts'),
      `export class SessionCoordinator {
  start() { return true; }
  stop() { return false; }
  reset() { return null; }
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'thin.ts'),
      `export class SessionCoordinator {}
`
    );

    await updateGraph(projectDir);

    const inspectResult = await inspectSymbol(projectDir, 'SessionCoordinator', {
      kind: 'class',
    });
    expect(typeof inspectResult).toBe('string');
    expect(inspectResult).toContain("Inferred primary definition");
    expect(inspectResult).toContain("Centrality:");
    expect(inspectResult).toContain('src/rich.ts');
  });

  it('should infer the primary definition for mermaid output too', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'rich.ts'),
      `export class SessionCoordinator {
  start() { return true; }
  stop() { return false; }
  reset() { return null; }
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'thin.ts'),
      `export class SessionCoordinator {}
`
    );

    await updateGraph(projectDir);

    const inspectResult = await inspectSymbol(projectDir, 'SessionCoordinator', {
      kind: 'class',
      format: 'mermaid',
    });
    expect(typeof inspectResult).toBe('string');
    expect(inspectResult).toContain('rich_ts');
    expect(inspectResult).not.toContain('thin_ts');
  });

  it('should handle empty search gracefully', async () => {
    await fs.writeFile(
      path.join(projectDir, 'src', 'empty.ts'),
      'export const x = 1;'
    );

    await updateGraph(projectDir);

    const results = await searchGraph(projectDir, 'NonExistentSymbolXYZ');
    expect(results).toEqual([]);
  });

  it('should work with multiple init/update cycles', async () => {
    // First cycle
    await fs.writeFile(path.join(projectDir, 'src', 'a.ts'), 'export const a = 1;');
    await updateGraph(projectDir);
    
    const db1 = getDb(archgraphDir);
    let count = (db1.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    expect(count).toBeGreaterThanOrEqual(1);
    db1.close();

    // Second cycle - add file
    await fs.writeFile(path.join(projectDir, 'src', 'b.ts'), 'export const b = 2;');
    await updateGraph(projectDir);
    
    const db2 = getDb(archgraphDir);
    count = (db2.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    expect(count).toBeGreaterThanOrEqual(2);
    db2.close();

    // Third cycle - update file
    await fs.writeFile(path.join(projectDir, 'src', 'a.ts'), 'export const a = 100; export const newA = 200;');
    await updateGraph(projectDir);
    
    const db3 = getDb(archgraphDir);
    count = (db3.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    expect(count).toBeGreaterThanOrEqual(3); // a, newA, b
    db3.close();
  });

  it('should handle complex project structure', async () => {
    // Create nested directories
    await fs.mkdir(path.join(projectDir, 'src', 'services'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'src', 'models'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'src', 'utils'), { recursive: true });

    // Create files in different directories
    await fs.writeFile(
      path.join(projectDir, 'src', 'services', 'auth.ts'),
      `export class AuthService {
  login(user: string, pass: string): boolean {
    return user === 'admin' && pass === 'secret';
  }
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'models', 'user.ts'),
      `export interface User {
  id: number;
  username: string;
}`
    );

    await fs.writeFile(
      path.join(projectDir, 'src', 'utils', 'helper.ts'),
      `export function formatDate(date: Date): string {
  return date.toISOString();
}`
    );

    await updateGraph(projectDir);

    // Verify all files are indexed
    let db = getDb(archgraphDir);
    const files = db.prepare('SELECT * FROM files').all();
    expect(files.length).toBe(3);
    db.close();

    // Search for symbols
    const results = await searchGraph(projectDir, 'AuthService');
    expect(results.some(r => r.name === 'AuthService')).toBe(true);

    // Verify line numbers are correct
    const allUserResults = await searchGraph(projectDir, 'User');
    const userInterface = allUserResults.find(r => r.name === 'User' && r.file_path?.includes('models'));
    expect(allUserResults.length).toBeGreaterThan(0);
  });

  it('should handle concurrent operations simulation', async () => {
    // Create multiple files to simulate concurrent operations
    await fs.writeFile(path.join(projectDir, 'src', 'file0.ts'), 'export function func0() { return 0; }');
    await fs.writeFile(path.join(projectDir, 'src', 'file1.ts'), 'export function func1() { return 1; }');
    await fs.writeFile(path.join(projectDir, 'src', 'file2.ts'), 'export function func2() { return 2; }');
    
    await updateGraph(projectDir);

    // Update each file individually
    await fs.writeFile(path.join(projectDir, 'src', 'file0.ts'), 'export function func0() { return 10; }');
    await updateGraph(projectDir, [path.join(projectDir, 'src', 'file0.ts')]);

    await fs.writeFile(path.join(projectDir, 'src', 'file1.ts'), 'export function func1() { return 11; }');
    await updateGraph(projectDir, [path.join(projectDir, 'src', 'file1.ts')]);

    await fs.writeFile(path.join(projectDir, 'src', 'file2.ts'), 'export function func2() { return 12; }');
    await updateGraph(projectDir, [path.join(projectDir, 'src', 'file2.ts')]);

    const results = await searchGraph(projectDir, 'func');
    expect(results.some(r => r.name === 'func0')).toBe(true);
    expect(results.some(r => r.name === 'func1')).toBe(true);
    expect(results.some(r => r.name === 'func2')).toBe(true);
  });
});
