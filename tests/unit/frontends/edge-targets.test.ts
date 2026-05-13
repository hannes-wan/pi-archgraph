import { describe, it, expect } from 'vitest';
import { inferSemanticTarget, normalizeSemanticTarget } from '../../../src/frontends/edge-targets.js';

describe('edge-targets', () => {
  it('resolves aliased import targets to the imported symbol', () => {
    const bindings = [
      {
        module: 'node:fs',
        importedName: 'readFileSync',
        localName: 'readFile',
      },
    ];

    expect(
      inferSemanticTarget('readFile', 'node:fs::readFileSync', bindings)
    ).toBe('node:fs::readFileSync');
  });

  it('normalizes away wrapper syntax before binding resolution', () => {
    expect(normalizeSemanticTarget('new this.client.read()')).toBe('client.read');
  });
});
