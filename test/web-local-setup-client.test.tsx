import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Settings } from '../src/web/client/Settings.js';
import type { ApiClient, LauncherSettings } from '../src/web/client/api.js';

const settings: LauncherSettings = {
  setupRequired: true,
  deviceName: 'Desktop',
  web: { host: '127.0.0.1', port: 4317, origin: 'http://127.0.0.1:4317', tlsConfigured: false },
  projectRoots: [],
};

describe('local setup client', () => {
  it('shows root authorization before allowing setup to be saved', () => {
    const html = renderToStaticMarkup(
      <Settings api={{} as ApiClient} settings={settings} onSaved={() => undefined} setup />,
    );
    expect(html).toContain('Authorized project folders');
    expect(html).toContain('No additional local folders were detected.');
    expect(html).not.toContain('/mnt/');
  });
});
