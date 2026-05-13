import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { hashString, hashFile } from '../../../src/util/hashing.js';

describe('hashing', () => {
  describe('hashString', () => {
    it('returns a SHA-256 hash', () => {
      const result = hashString('hello');
      expect(result).toHaveLength(64); // SHA-256 hex is 64 chars
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it('produces consistent hashes for same input', () => {
      const input = 'test string';
      const hash1 = hashString(input);
      const hash2 = hashString(input);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashString('input1');
      const hash2 = hashString('input2');
      expect(hash1).not.toBe(hash2);
    });

    it('handles empty string', () => {
      const result = hashString('');
      expect(result).toHaveLength(64);
    });

    it('handles unicode characters', () => {
      const result = hashString('こんにちは世界🌍');
      expect(result).toHaveLength(64);
    });

    it('handles large input', () => {
      const largeInput = 'x'.repeat(100000);
      const result = hashString(largeInput);
      expect(result).toHaveLength(64);
    });
  });

  describe('hashFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archgraph-hash-test-'));
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it('returns SHA-256 hash of file content', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'hello', 'utf-8');

      const result = await hashFile(filePath);
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it('produces consistent hashes for same file', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'content', 'utf-8');

      const hash1 = await hashFile(filePath);
      const hash2 = await hashFile(filePath);
      expect(hash1).toBe(hash2);
    });

    it('matches hashString for same content', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'file content';
      await fs.writeFile(filePath, content, 'utf-8');

      const fileHash = await hashFile(filePath);
      const stringHash = hashString(content);
      expect(fileHash).toBe(stringHash);
    });

    it('returns empty string for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');
      const result = await hashFile(filePath);
      expect(result).toBe('');
    });

    it('handles binary file content', async () => {
      const filePath = path.join(tempDir, 'binary.bin');
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      await fs.writeFile(filePath, binaryData);

      const result = await hashFile(filePath);
      expect(result).toHaveLength(64);
    });

    it('handles large file', async () => {
      const filePath = path.join(tempDir, 'large.txt');
      const largeContent = 'data'.repeat(25000);
      await fs.writeFile(filePath, largeContent, 'utf-8');

      const result = await hashFile(filePath);
      expect(result).toHaveLength(64);
    });
  });
});
