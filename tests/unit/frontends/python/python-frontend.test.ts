import { describe, it, expect, beforeEach } from 'vitest';
import { PythonFrontend } from '../../../../src/frontends/python/python-frontend.js';

describe('PythonFrontend', () => {
  let frontend: PythonFrontend;

  beforeEach(() => {
    frontend = new PythonFrontend();
  });

  it('resolves aliased from-imports to the imported symbol in depends_on edges', async () => {
    const filePath = '/tmp/sample.py';
    const content = `
from pathlib import Path as P

class Loader:
    def read(self):
        return P('config.json').read_text()
`;

    const result = await frontend.parseFile(filePath, content);
    const methodId = `method:${filePath}:Loader.read`;

    expect(result.edges.some((edge) =>
      edge.kind === 'depends_on' &&
      edge.from_id === methodId &&
      edge.to_id === 'pathlib::Path'
    )).toBe(true);
  });
});
