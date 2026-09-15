import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Web application root is missing');
}

createRoot(root).render(
  <StrictMode>
    <main className="app-shell">
      <h1>Binaflow</h1>
      <p>Personal workflow workspace</p>
    </main>
  </StrictMode>,
);
