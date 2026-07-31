import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';

describe('Binaflow CLI', () => {
  it('exposes the initial operator commands in help', () => {
    const help = createCli().helpInformation();

    expect(help).toContain('run');
    expect(help).toContain('runs');
    expect(help).toContain('show');
    expect(help).toContain('resume');
    expect(help).toContain('--verbose');
  });
});
