import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Projects } from '../src/web/client/Projects.js';
import type { ApiClient } from '../src/web/client/api.js';

describe('web project client', () => {
  it('renders project and server-folder controls as text and controls', () => {
    const html = renderToStaticMarkup(<Projects api={{} as ApiClient} />);
    expect(html).toContain('Projects');
    expect(html).toContain('Add a project');
    expect(html).toContain('Server folder');
    expect(html).not.toContain('workspacePath');
  });
});
