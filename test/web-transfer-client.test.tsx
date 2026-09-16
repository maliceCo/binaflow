import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TransferWizard } from '../src/web/client/TransferWizard.js';
import type { ApiClient } from '../src/web/client/api.js';

describe('web transfer client', () => {
  it('renders a guided handoff without exposing filesystem paths', () => {
    const html = renderToStaticMarkup(<TransferWizard api={{} as ApiClient} />);
    expect(html).toContain('Transfer project');
    expect(html).toContain('Preview');
    expect(html).toContain('Confirm transfer');
    expect(html).toContain('New transfer');
    expect(html).not.toContain('workspacePath');
    expect(html).not.toContain('packagePath');
  });
});
