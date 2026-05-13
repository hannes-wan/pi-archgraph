import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  getArchgraphDir,
  ensureArchgraphDir,
} from '../../../src/util/paths.js';

describe('paths', () => {
  describe('getArchgraphDir', () => {
    it('returns path to .pi/archgraph', () => {
      const cwd = '/some/project';
      const result = getArchgraphDir(cwd);
      expect(result).toBe(path.join(cwd, '.pi', 'archgraph'));
    });

    it('handles trailing slash in cwd', () => {
      const cwd = '/some/project/';
      const result = getArchgraphDir(cwd);
      expect(result).toBe(path.join('/some/project', '.pi', 'archgraph'));
    });
  });

  describe('ensureArchgraphDir', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join((await import('node:os')).tmpdir(), 'archgraph-paths-test-')
      );
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('creates .pi/archgraph directory', async () => {
      const result = await ensureArchgraphDir(tempDir);
      expect(result).toBe(getArchgraphDir(tempDir));
      await expect(fs.access(path.join(tempDir, '.pi', 'archgraph'))).resolves.not.toThrow();
    });

    it('creates locks subdirectory', async () => {
      await ensureArchgraphDir(tempDir);
      const locksDir = path.join(tempDir, '.pi', 'archgraph', 'locks');
      await expect(fs.access(locksDir)).resolves.not.toThrow();
    });

    it('creates docs subdirectory', async () => {
      await ensureArchgraphDir(tempDir);
      const docsDir = path.join(tempDir, '.pi', 'archgraph', 'docs');
      await expect(fs.access(docsDir)).resolves.not.toThrow();
    });

    it('is idempotent - does not throw on subsequent calls', async () => {
      await ensureArchgraphDir(tempDir);
      await expect(ensureArchgraphDir(tempDir)).resolves.not.toThrow();
    });

    it('returns the archgraph directory path', async () => {
      const result = await ensureArchgraphDir(tempDir);
      expect(result).toBe(path.join(tempDir, '.pi', 'archgraph'));
    });
  });
});
