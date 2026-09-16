import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Settings } from '../src/web/client/Settings.js';
import type { ApiClient, LauncherSettings } from '../src/web/client/api.js';

const settings: LauncherSettings = {
  setupRequired: true,
  deviceName: 'Desktop',
  web: { host: '127.0.0.1', port: 4317, origin: 'http://127.0.0.1:4317', tlsConfigured: false },
  projectRoots: [{ id: 'root-1', label: 'Projects' }],
};

const api = {
  revokeProjectRoot: async () => ({ settings, restartRequired: false }),
} as unknown as ApiClient;

describe('web settings client', () => {
  it('renders an accessible local setup form without exposing secrets', () => {
    const html = renderToStaticMarkup(
      <Settings api={api} settings={settings} onSaved={() => undefined} setup />,
    );
    expect(html).toContain('Computer name');
    expect(html).toContain('HTTPS certificate');
    expect(html).toContain('Private keys are never returned');
    expect(html).toContain('Remove authorization');
    expect(html).not.toContain('undefined');
  });
});
