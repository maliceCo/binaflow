import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWebSettingsController,
  defaultWebSettings,
  launcherSettingsToWebConfig,
  loadOrBootstrapWebSettings,
  readWebSettingsSourceHash,
  resolveDefaultWebSettingsPath,
  saveWebSettingsAtomically,
} from '../src/web/settings-store.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('web settings store', () => {
  it('resolves private global locations without reading the real home', () => {
    expect(
      resolveDefaultWebSettingsPath({
        platform: 'linux',
        env: { XDG_CONFIG_HOME: '/tmp/config', HOME: '/tmp/home' },
      }),
    ).toBe('/tmp/config/binaflow/web.json');
    expect(resolveDefaultWebSettingsPath({ platform: 'linux', env: { HOME: '/tmp/home' } })).toBe(
      '/tmp/home/.config/binaflow/web.json',
    );
    expect(
      resolveDefaultWebSettingsPath({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\test\\AppData' },
      }),
    ).toBe('C:\\Users\\test\\AppData/binaflow/web.json');
  });

  it('bootstraps in memory, saves atomically, and reloads strict settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-web-settings-'));
    directories.push(directory);
    const path = join(directory, 'web.json');
    const initial = await loadOrBootstrapWebSettings(path);
    expect(initial).toEqual(defaultWebSettings());

    const settings = { ...initial, deviceName: 'Desktop' };
    const savedHash = await saveWebSettingsAtomically(settings, { path });
    expect(await readWebSettingsSourceHash(path)).toBe(savedHash);
    expect(await loadOrBootstrapWebSettings(path)).toEqual(settings);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it('uses last-good after a corrupt replacement and rejects a stale CAS write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-web-settings-'));
    directories.push(directory);
    const path = join(directory, 'web.json');
    const first = { ...defaultWebSettings(), deviceName: 'First' };
    const firstHash = await saveWebSettingsAtomically(first, { path });
    const second = { ...first, deviceName: 'Second' };
    await saveWebSettingsAtomically(second, { path, expectedSourceHash: firstHash });
    await writeFile(path, '{broken', 'utf8');
    expect(await loadOrBootstrapWebSettings(path)).toEqual(first);
    await expect(
      saveWebSettingsAtomically(
        { ...second, deviceName: 'Third' },
        { path, expectedSourceHash: firstHash },
      ),
    ).rejects.toThrow(/changed/i);
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });

  it('requires restart when the experimental peer transport changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-web-settings-'));
    directories.push(directory);
    const path = join(directory, 'web.json');
    const initial = defaultWebSettings();
    const controller = createWebSettingsController(path, initial);
    const result = await controller.update({
      ...initial,
      peerTransport: {
        mode: 'lan-experimental',
        host: '192.168.1.10',
        port: 4318,
        warningAccepted: true,
      },
    });
    expect(result.restartRequired).toBe(true);
  });

  it('maps launcher settings to the existing strict web config', () => {
    expect(launcherSettingsToWebConfig(defaultWebSettings())).toEqual({
      host: '127.0.0.1',
      port: 4317,
      origin: 'http://127.0.0.1:4317',
    });
  });
});
