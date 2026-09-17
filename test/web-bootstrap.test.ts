import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('web launcher bootstrap', () => {
  it('rejects machine output before reading launcher settings', async () => {
    await expect(createCli().parseAsync(['node', 'binaflow', '--json', 'web'])).rejects.toThrow(
      /machine output/i,
    );
  });
});
