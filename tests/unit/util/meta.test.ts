import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getMeta,
  setMeta,
  markDirty,
  clearDirty,
  isStale,
  type MetaData,
} from '../../../src/util/meta.js';
import { ensureArchgraphDir, getArchgraphDir } from '../../../src/util/paths.js';

describe('meta', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-meta-test-'));
    // Ensure the .pi/archgraph directory exists
    await ensureArchgraphDir(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('getMeta', () => {
    it('returns null when meta.json does not exist', async () => {
      const result = await getMeta(tempDir);
      expect(result).toBeNull();
    });

    it('returns parsed meta.json when it exists', async () => {
      const metaData: MetaData = {
        schemaVersion: 2,
        indexedCommit: 'abc123',
        indexedAt: Date.now(),
        dirtyFiles: [],
        lastUpdateReason: 'init',
      };
      const metaPath = path.join(getArchgraphDir(tempDir), 'meta.json');
      await fs.writeFile(metaPath, JSON.stringify(metaData), 'utf-8');

      const result = await getMeta(tempDir);
      expect(result).toEqual(metaData);
    });
  });

  describe('setMeta', () => {
    it('creates meta.json with default values when none exists', async () => {
      await setMeta(tempDir, {});
      const meta = await getMeta(tempDir);
      expect(meta).toBeDefined();
      expect(meta!.schemaVersion).toBe(2);
      expect(meta!.dirtyFiles).toEqual([]);
    });

    it('updates only specified fields', async () => {
      await setMeta(tempDir, { indexedCommit: 'abc123' });
      const meta = await getMeta(tempDir);
      expect(meta!.indexedCommit).toBe('abc123');
      expect(meta!.lastUpdateReason).toBeNull();
    });

    it('merges with existing meta', async () => {
      await setMeta(tempDir, { schemaVersion: 3 });
      await setMeta(tempDir, { indexedCommit: 'def456' });
      const meta = await getMeta(tempDir);
      expect(meta!.schemaVersion).toBe(3);
      expect(meta!.indexedCommit).toBe('def456');
    });
  });

  describe('markDirty', () => {
    it('adds files to dirty list', async () => {
      await markDirty(tempDir, ['src/a.ts', 'src/b.ts']);
      const meta = await getMeta(tempDir);
      expect(meta!.dirtyFiles).toContain('src/a.ts');
      expect(meta!.dirtyFiles).toContain('src/b.ts');
    });

    it('accumulates dirty files', async () => {
      await markDirty(tempDir, ['src/a.ts']);
      await markDirty(tempDir, ['src/b.ts']);
      const meta = await getMeta(tempDir);
      expect(meta!.dirtyFiles).toHaveLength(2);
      expect(meta!.dirtyFiles).toContain('src/a.ts');
      expect(meta!.dirtyFiles).toContain('src/b.ts');
    });

    it('does not duplicate files', async () => {
      await markDirty(tempDir, ['src/a.ts']);
      await markDirty(tempDir, ['src/a.ts']);
      const meta = await getMeta(tempDir);
      expect(meta!.dirtyFiles).toHaveLength(1);
    });
  });

  describe('clearDirty', () => {
    it('clears all dirty files', async () => {
      await markDirty(tempDir, ['src/a.ts', 'src/b.ts']);
      await clearDirty(tempDir);
      const meta = await getMeta(tempDir);
      expect(meta!.dirtyFiles).toEqual([]);
    });
  });

  describe('isStale', () => {
    it('returns true when meta.json does not exist', async () => {
      const result = await isStale(tempDir);
      expect(result).toBe(true);
    });

    it('returns true when indexedAt is older than threshold', async () => {
      await setMeta(tempDir, { indexedAt: Date.now() - 120000 });
      const result = await isStale(tempDir, 60000);
      expect(result).toBe(true);
    });

    it('returns false when indexedAt is within threshold', async () => {
      await setMeta(tempDir, { indexedAt: Date.now() });
      const result = await isStale(tempDir, 60000);
      expect(result).toBe(false);
    });

    it('uses default threshold of 60000ms', async () => {
      await setMeta(tempDir, { indexedAt: Date.now() - 30000 });
      const result = await isStale(tempDir);
      expect(result).toBe(false);
    });
  });
});
