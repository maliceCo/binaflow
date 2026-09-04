import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('Binaflow CLI', () => {
  it('guides an incomplete run command without opening runtime dependencies', async () => {
    await expect(createCli().parseAsync(['node', 'binaflow', 'run'])).rejects.toThrow(
      /Missing workflow and objective.*Available workflows:.*plan-build.*plan-build-qa/s,
    );
  });

  it('requires reviewed TODO content for todo-build-qa before opening runtime dependencies', async () => {
    await expect(
      createCli().parseAsync([
        'node',
        'binaflow',
        'run',
        'todo-build-qa',
        '--objective',
        'Execute TODO',
      ]),
    ).rejects.toThrow(/Missing todo.*--todo-file/s);
  });

  it('rejects --todo-file for unrelated workflows', async () => {
    await expect(
      createCli().parseAsync([
        'node',
        'binaflow',
        'run',
        'plan-build',
        '--objective',
        'Execute TODO',
        '--todo-file',
        'TODO.md',
      ]),
    ).rejects.toMatchObject({ code: 'TODO_FILE_WORKFLOW_MISMATCH', exitCode: 2 });
  });
});
