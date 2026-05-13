import { beforeAll, afterAll, vi } from 'vitest';

// Global test timeout
vi.setConfig({
  testTimeout: 10000,
});

// Clean up after all tests
afterAll(() => {
  // Cleanup if needed
});
