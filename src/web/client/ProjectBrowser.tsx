import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, ProjectDirectory, ProjectSummary } from './api.js';

export function ProjectBrowser(props: {
  api: ApiClient;
  onRegistered: (project: ProjectSummary) => Promise<void>;
  onManageLocations?: (() => void) | undefined;
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

  async function initialize(): Promise<void> {
    if (busy || currentIsProject) return;
    setBusy(true);
    setError(undefined);
    try {
      const project = await props.api.initializeProject(rootId, segments);
      await props.onRegistered(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not initialize project');
    } finally {
      setBusy(false);
    }
  }

  async function register(projectSegments: string[]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const project = await props.api.registerProject(rootId, projectSegments);
      await props.onRegistered(project);
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
          <h3 id="project-browser-title">Find a project</h3>
          <p className="muted">Choose a project from one of your project locations.</p>
        </div>
        {currentIsProject && (
          <button type="button" disabled={busy} onClick={() => void register(segments)}>
            {busy ? 'Opening...' : 'Open this project'}
          </button>
        )}
        {!currentIsProject && roots.length > 0 && (
          <button type="button" disabled={busy} onClick={() => void initialize()}>
            {busy ? 'Initializing...' : 'Initialize Binaflow here'}
          </button>
        )}
      </div>
      {roots.length === 0 ? (
        <div className="empty-state compact">
          <strong>No project locations yet.</strong>
          <p>Choose a folder in Project locations before browsing for a project.</p>
          {props.onManageLocations && (
            <button type="button" onClick={props.onManageLocations}>
              Manage project locations
            </button>
          )}
        </div>
      ) : null}
      {roots.length > 0 && (
        <>
          <label htmlFor="project-root">Project location</label>
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
                  aria-label={
                    item.hasBinaflowConfig ? `${item.name} (Binaflow project)` : item.name
                  }
                  disabled={busy}
                  onClick={() =>
                    item.hasBinaflowConfig
                      ? void register(item.segments)
                      : setSegments(item.segments)
                  }
                >
                  <span>{item.hasBinaflowConfig ? '◆' : '▸'}</span>
                  <span>
                    {item.name}
                    {item.hasBinaflowConfig && <small>Binaflow project · click to open</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
