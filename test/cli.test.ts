import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('Binaflow CLI', () => {
  it('exposes the initial operator commands in help', () => {
    const help = createCli().helpInformation();

    expect(help).toContain('run');
    expect(help).toContain('runs');
    expect(help).toContain('show');
    expect(help).toContain('resume');
    expect(help).toContain('approve');
    expect(help).toContain('reject');
    expect(help).toContain('--verbose');
    expect(help).toContain('--json');
    expect(help).toContain('--jsonl');
    expect(help).toContain('workflows');
    expect(help).toContain('artifact');
    expect(help).toContain('tui');
  });

  it('guides an incomplete run command without opening runtime dependencies', async () => {
    await expect(createCli().parseAsync(['node', 'binaflow', 'run'])).rejects.toThrow(
      /Missing workflow and objective.*Available workflows:.*plan-build/s,
    );
  });
});
