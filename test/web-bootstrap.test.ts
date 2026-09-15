import { describe, expect, it } from 'vitest';
import { createCli } from '../src/cli/index.js';
import { defaultWebSettings, launcherSettingsToWebConfig } from '../src/web/settings-store.js';

describe('web launcher bootstrap', () => {
  it('rejects machine output before reading launcher settings', async () => {
    await expect(createCli().parseAsync(['node', 'binaflow', '--json', 'web'])).rejects.toThrow(
      /machine output/i,
    );
  });

  it('starts from loopback settings without a project context', () => {
    const settings = defaultWebSettings();
    expect(settings.setupRequired).toBe(true);
    expect(settings.projectRoots).toEqual([]);
    expect(launcherSettingsToWebConfig(settings)).toMatchObject({
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:4317',
    });
  });
});
