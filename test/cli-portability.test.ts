import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('portable transfer CLI commands', () => {
  it('registers explicit preview/export/import commands', () => {
    const commands = createCli().commands.map((command) => command.name());
    expect(commands).toEqual(
      expect.arrayContaining([
        'preview-export',
        'export',
        'cancel-export',
        'inspect',
        'preview-import',
        'import',
      ]),
    );
  });

  it('rejects JSONL before opening a portability context', async () => {
    const cli = createCli();
    await expect(
      cli.parseAsync([
        'node',
        'binaflow',
        'preview-export',
        '--request-id',
        '11111111-1111-4111-8111-111111111111',
        '--output',
        '/tmp/transfer',
        '--jsonl',
      ]),
    ).rejects.toThrow(/supports --json, not --jsonl/);
  });
});
