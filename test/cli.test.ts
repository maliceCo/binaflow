import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('Binaflow CLI', () => {
  it('guides an incomplete run command without opening runtime dependencies', async () => {
    await expect(createCli().parseAsync(['node', 'binaflow', 'run'])).rejects.toThrow(
      /Missing workflow and objective.*Available workflows:.*plan-build.*plan-build-qa/s,
    );
  });
});
