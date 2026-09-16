import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, ProjectDirectory } from './api.js';

export function ProjectBrowser(props: {
  api: ApiClient;
  onRegistered: () => Promise<void>;
}): ReactElement {
  const [roots, setRoots] = useState<Array<{ id: string; label: string }>>([]);
  const [rootId, setRootId] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [items, setItems] = useState<ProjectDirectory[]>([]);
  const [currentIsProject, setCurrentIsProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void props.api
      .listProjectRoots()
      .then((next) => {
        setRoots(next);
        setRootId(next[0]?.id ?? '');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load roots'));
  }, [props.api]);

  useEffect(() => {
    if (!rootId) return;
    void props.api
      .listProjectDirectory(rootId, segments)
      .then((result) => {
        setItems(result.items);
        setCurrentIsProject(result.hasBinaflowConfig);
        setError(undefined);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not browse projects'),
      );
  }, [props.api, rootId, segments]);

  async function register(projectSegments: string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.api.registerProject(rootId, projectSegments);
      await props.onRegistered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="project-browser" aria-labelledby="project-browser-title">
      <div className="section-heading">
        <div>
          <h3 id="project-browser-title">Add a project</h3>
          <p className="muted">Browse only inside an authorized folder.</p>
        </div>
        {currentIsProject && (
          <button type="button" disabled={busy} onClick={() => void register(segments)}>
            {busy ? 'Adding...' : 'Add this folder'}
          </button>
        )}
      </div>
      <label htmlFor="project-root">Authorized folder</label>
      <select
        id="project-root"
        value={rootId}
        onChange={(event) => {
          setRootId(event.target.value);
          setSegments([]);
        }}
      >
        {roots.map((root) => (
          <option key={root.id} value={root.id}>
            {root.label}
          </option>
        ))}
      </select>
      <div className="browser-path">
        <code>{segments.length ? `/${segments.join('/')}` : '/'}</code>
        {segments.length > 0 && (
          <button
            className="button-secondary"
            type="button"
            onClick={() => setSegments((current) => current.slice(0, -1))}
          >
            Up one level
          </button>
        )}
      </div>
      <ul className="folder-list">
        {items.map((item) => (
          <li key={item.segments.join('/') + item.name}>
            <button
              type="button"
              className={item.hasBinaflowConfig ? 'project-folder' : 'folder'}
              aria-label={item.hasBinaflowConfig ? `${item.name} (Binaflow project)` : item.name}
              disabled={busy}
              onClick={() =>
                item.hasBinaflowConfig ? void register(item.segments) : setSegments(item.segments)
              }
            >
              <span>{item.hasBinaflowConfig ? '◆' : '▸'}</span>
              <span>
                {item.name}
                {item.hasBinaflowConfig && <small>Binaflow project · click to add</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
