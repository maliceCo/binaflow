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
        setError(undefined);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not browse projects'),
      );
  }, [props.api, rootId, segments]);

  async function register(item: ProjectDirectory): Promise<void> {
    try {
      await props.api.registerProject(rootId, item.segments);
      await props.onRegistered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add project');
    }
  }

  return (
    <section aria-labelledby="project-browser-title">
      <h3 id="project-browser-title">Add a project</h3>
      <label htmlFor="project-root">Server folder</label>
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
      <p>{segments.length ? `/${segments.join('/')}` : '/'}</p>
      {segments.length > 0 && (
        <button type="button" onClick={() => setSegments((current) => current.slice(0, -1))}>
          Up
        </button>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.segments.join('/') + item.name}>
            <button
              type="button"
              onClick={() =>
                item.hasBinaflowConfig ? void register(item) : setSegments(item.segments)
              }
            >
              {item.name}
              {item.hasBinaflowConfig ? ' (Binaflow project)' : ''}
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
