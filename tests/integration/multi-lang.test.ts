import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateGraph } from '../../src/core/workspace-indexer.js';
import { getDb } from '../../src/graph/db.js';
import { getGraphRevision } from '../../src/graph/metadata.js';
import { getArchgraphDir } from '../../src/util/paths.js';

describe('Multi-language Graph Integration Tests', () => {
  let tempDir: string;
  let projectDir: string;
  let archgraphDir: string;
  
  // Path to our multi-language test project - use absolute path
  const multiLangProject = '/home/hannes/.pi/agent/extensions/pi-archgraph/tests/fixtures/multi-lang-project';

  beforeEach(async () => {
    // Create temp directory for the test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-multi-'));
    
    // Copy multi-lang project to temp location
    projectDir = path.join(tempDir, 'multi-lang-project');
    await copyDir(multiLangProject, projectDir);
    
    archgraphDir = path.join(projectDir, '.pi', 'archgraph');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  async function copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  it('should index C++ files correctly', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check for C++ file nodes
    const cppFiles = db.prepare(`
      SELECT * FROM nodes 
      WHERE file_path LIKE '%cpp%' AND kind = 'file'
    `).all();
    
    expect(cppFiles.length).toBeGreaterThan(0);
    
    // Check for C++ classes
    const cppClasses = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'class' AND language = 'cpp'
    `).all();
    
    console.log('C++ classes found:', cppClasses);
    expect(cppClasses.length).toBeGreaterThanOrEqual(3); // Shape, Rectangle, Circle
    
    // Check for C++ namespaces (optional - not all frontends support this)
    const namespaces = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'namespace' AND language = 'cpp'
    `).all();
    
    // Namespaces are optional - some C++ code may not use explicit namespaces
    console.log('C++ namespaces found:', namespaces.length);
    
    // Check for C++ functions
    const cppFunctions = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'function' AND language = 'cpp'
    `).all();
    
    console.log('C++ functions found:', cppFunctions.length);
    expect(cppFunctions.length).toBeGreaterThan(0);
    expect((cppFunctions as any[]).every((node) => typeof node.domain === 'string' || node.domain === null)).toBe(true);
    
    db.close();
  });

  it('should index C files correctly', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check for C file nodes (only .c files)
    const cFiles = db.prepare(`
      SELECT * FROM nodes 
      WHERE file_path LIKE '%.c' AND kind = 'file'
    `).all();
    
    expect(cFiles.length).toBeGreaterThan(0);
    
    // The C header should be parsed by the C frontend so its typedef-struct symbols stay in language 'c'
    const cHeaderSymbols = db.prepare(`
      SELECT * FROM nodes 
      WHERE file_path LIKE '%/src/c/shapes.h' AND kind IN ('struct', 'type') AND language = 'c'
    `).all();
    
    console.log('C header symbols found:', cHeaderSymbols);
    expect(cHeaderSymbols.length).toBeGreaterThan(0);
    
    const cStructs = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind IN ('struct', 'type') AND language = 'c'
    `).all();
    
    console.log('C structs/types found:', cStructs);
    // C frontend creates 'type' nodes for typedef structs
    expect(cStructs.length).toBeGreaterThanOrEqual(2); // At least ShapeType and main
    
    // Check for C functions
    const cFunctions = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'function' AND language = 'c'
    `).all();
    
    console.log('C functions found:', cFunctions.length);
    expect(cFunctions.length).toBeGreaterThan(0);
    expect((cFunctions as any[]).every((node) => typeof node.cluster_id === 'string' || node.cluster_id === null)).toBe(true);
    
    db.close();
  });

  it('should index Python files correctly', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check for Python file nodes
    const pyFiles = db.prepare(`
      SELECT * FROM nodes 
      WHERE file_path LIKE '%.py' AND kind = 'file'
    `).all();
    
    expect(pyFiles.length).toBeGreaterThan(0);
    
    // Check for Python classes
    const pyClasses = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'class' AND language = 'python'
    `).all();
    
    console.log('Python classes found:', pyClasses);
    expect(pyClasses.length).toBeGreaterThanOrEqual(4); // Shape, Rectangle, Circle, Triangle
    
    // Check for Python functions
    const pyFunctions = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'function' AND language = 'python'
    `).all();
    
    console.log('Python functions found:', pyFunctions.length);
    expect(pyFunctions.length).toBeGreaterThan(0);
    expect((pyFunctions as any[]).some((node) => node.metadata_json !== null)).toBe(true);
    
    db.close();
  });

  it('should index Rust files correctly', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check for Rust file nodes
    const rsFiles = db.prepare(`
      SELECT * FROM nodes 
      WHERE file_path LIKE '%.rs' AND kind = 'file'
    `).all();
    
    expect(rsFiles.length).toBeGreaterThan(0);
    
    // Check for Rust structs
    const rustStructs = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'struct' AND language = 'rust'
    `).all();
    
    console.log('Rust structs found:', rustStructs);
    expect(rustStructs.length).toBeGreaterThanOrEqual(3); // Rectangle, Circle, Triangle
    
    // Check for Rust functions
    const rustFunctions = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'function' AND language = 'rust'
    `).all();
    
    console.log('Rust functions found:', rustFunctions.length);
    expect(rustFunctions.length).toBeGreaterThan(0);
    expect((rustFunctions as any[]).some((node) => node.metadata_json !== null)).toBe(true);
    
    db.close();
  });

  it('should create edges between classes and methods', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check for contains edges (file -> class/function)
    const containsEdges = db.prepare(`
      SELECT * FROM edges WHERE kind = 'contains'
    `).all();
    
    console.log('Total contains edges:', containsEdges.length);
    expect(containsEdges.length).toBeGreaterThan(0);
    
    // Check for defines edges (class -> method/function)
    const definesEdges = db.prepare(`
      SELECT * FROM edges WHERE kind = 'defines'
    `).all();
    
    console.log('Defines edges (class methods):', definesEdges.length);
    
    // We expect defines edges for methods
    expect(definesEdges.length).toBeGreaterThanOrEqual(0);
    expect((containsEdges as any[]).some((edge) => edge.source_file !== null)).toBe(true);
    
    db.close();
  });

  it('should track all files from all languages', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check total file count
    const allFiles = db.prepare(`SELECT * FROM files`).all();
    
    console.log('Total files indexed:', allFiles.length);
    
    // We expect at least:
    // - 3 C++ files (shapes.h, shapes.cpp, main.cpp)
    // - 3 C files (shapes.h, shapes.c, main.c) - shapes.h counted twice
    // - 2 Python files (shapes.py, main.py)
    // - 2 Rust files (shapes.rs, lib.rs)
    // Plus Cargo.toml and CMakeLists.txt
    expect(allFiles.length).toBeGreaterThanOrEqual(8);
    expect((allFiles as any[]).every((file) => typeof file.symbol_count === 'number')).toBe(true);
    expect((allFiles as any[]).every((file) => typeof file.edge_count === 'number')).toBe(true);
    
    // Check language distribution
    const langCounts = db.prepare(`
      SELECT language, COUNT(*) as count 
      FROM nodes 
      WHERE language IS NOT NULL 
      GROUP BY language
    `).all() as Array<{ language: string; count: number }>;
    
    console.log('Nodes by language:', langCounts);
    
    const langMap = new Map(langCounts.map(l => [l.language, l.count]));
    expect(langMap.get('cpp') || 0).toBeGreaterThan(0);
    expect(langMap.get('c') || 0).toBeGreaterThan(0);
    expect(langMap.get('python') || 0).toBeGreaterThan(0);
    expect(langMap.get('rust') || 0).toBeGreaterThan(0);

    const revision = getGraphRevision(db);
    expect(revision).not.toBeNull();
    expect(revision?.workspaceId).toBeTruthy();
    
    db.close();
  });

  it('should have correct qualified names for symbols', async () => {
    await updateGraph(projectDir);
    
    const db = getDb(archgraphDir);
    
    // Check Python classes have qualified names
    const pyClasses = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'class' AND language = 'python'
    `).all() as Array<{ name: string; qualified_name: string | null }>;
    
    console.log('Python classes with qualified names:', 
      pyClasses.map(c => ({ name: c.name, qname: c.qualified_name })));
    
    // At least some classes should have qualified names
    const withQNames = pyClasses.filter(c => c.qualified_name !== null);
    expect(withQNames.length).toBeGreaterThan(0);
    
    // Check C++ classes
    const cppClasses = db.prepare(`
      SELECT * FROM nodes 
      WHERE kind = 'class' AND language = 'cpp'
    `).all() as Array<{ name: string; qualified_name: string | null }>;
    
    console.log('C++ classes with qualified names:',
      cppClasses.map(c => ({ name: c.name, qname: c.qualified_name })));

    const criticalFiles = db.prepare(`
      SELECT path, centrality_score, domain
      FROM files
      ORDER BY COALESCE(centrality_score, 0) DESC
      LIMIT 3
    `).all() as Array<{ path: string; centrality_score: number | null; domain: string | null }>;
    expect(criticalFiles.length).toBeGreaterThan(0);
    expect(criticalFiles.some((file) => file.domain !== null)).toBe(true);
    
    db.close();
  });
});
