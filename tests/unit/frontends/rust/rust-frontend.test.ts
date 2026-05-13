import { describe, it, expect, beforeEach } from 'vitest';
import { RustFrontend } from '../../../../src/frontends/rust/rust-frontend.js';

describe('RustFrontend', () => {
  let frontend: RustFrontend;

  beforeEach(() => {
    frontend = new RustFrontend();
  });

  it('resolves aliased use imports to the imported symbol in depends_on edges', async () => {
    const filePath = '/tmp/sample.rs';
    const content = `
use std::fs::read_to_string as read_file;

fn load() {
    let _config = read_file("config.toml");
}
`;

    const result = await frontend.parseFile(filePath, content);
    const functionId = `function:${filePath}:load`;

    expect(result.edges.some((edge) =>
      edge.kind === 'depends_on' &&
      edge.from_id === functionId &&
      edge.to_id === 'std::fs::read_to_string'
    )).toBe(true);
  });
});
