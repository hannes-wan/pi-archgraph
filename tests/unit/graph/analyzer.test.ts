import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDb } from '../../../src/graph/db.js';
import { GraphAnalyzer } from '../../../src/graph/analyzer.js';

describe('GraphAnalyzer', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'archgraph-analyzer-test-'));
  const archgraphDir = path.join(tempDir, '.pi', 'archgraph');

  let db: ReturnType<typeof getDb>;
  let analyzer: GraphAnalyzer;

  beforeEach(() => {
    fs.mkdirSync(archgraphDir, { recursive: true });
    db = getDb(archgraphDir);
    analyzer = new GraphAnalyzer(db);

    db.exec(`
      INSERT INTO nodes (id, language, kind, name, qualified_name, file_path, start_line, end_line, summary, domain, subsystem, centrality_score) VALUES
      ('file:/src/a.ts', 'typescript', 'file', 'a.ts', NULL, '/src/a.ts', 1, 100, 'source file', 'analysis', 'ranking', 0),
      ('func:low', 'typescript', 'function', 'low', 'low', '/src/a.ts', 10, 20, 'decision-support candidate', NULL, NULL, 5),
      ('func:high', 'typescript', 'function', 'high', 'high', '/src/a.ts', 30, 40, 'decision-support candidate', 'analysis', 'ranking', 5),
      ('func:target', 'typescript', 'function', 'target', 'target', '/src/a.ts', 50, 60, 'target node', 'analysis', 'ranking', 0);

      INSERT INTO edges (id, from_id, to_id, kind, confidence) VALUES
      ('calls:low:target', 'func:low', 'func:target', 'calls', 1.0),
      ('calls:high:target', 'func:high', 'func:target', 'calls', 1.0);
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('derives a decision_score for ranked nodes from existing graph signals', () => {
    const ranked = analyzer.rankNodes();
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]).toHaveProperty('decision_score');
  });
});
