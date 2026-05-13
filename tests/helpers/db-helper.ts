import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archgraph-test-'));
}

export function createTestDb(tempDir: string): { db: Database.Database; dbPath: string } {
  const dbPath = path.join(tempDir, 'graph.db');
  const db = new Database(dbPath);
  return { db, dbPath };
}

export function cleanupTempDir(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
