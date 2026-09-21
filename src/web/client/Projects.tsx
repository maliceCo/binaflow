import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, ProjectSummary } from './api.js';
import { LocalProjectPicker } from './LocalProjectPicker.js';

export function Projects(props: {
  api: ApiClient;
  onProjectChanged?: () => Promise<void>;
  onProjectOpened?: () => void;
}): ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showBrowser, setShowBrowser] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const [nextProjects, active] = await Promise.all([
        props.api.listProjects(),
        props.api.getActiveProject(),
      ]);
      setProjects(nextProjects);
      setActiveId(active?.id);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load projects');
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.api]);

  async function select(projectId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const active = await props.api.selectProject(projectId);
      setActiveId(active.id);
      setError(undefined);
      await props.onProjectChanged?.();
      props.onProjectOpened?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not select project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="projects-panel panel" aria-labelledby="projects-title">
      <div className="section-heading">
        <h2 id="projects-title">Recent projects</h2>
      </div>
      {projects.length === 0 ? (
        <p>No projects registered.</p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id} className={project.id === activeId ? 'is-active' : ''}>
              <span>
                <strong>{project.name}</strong>
                <small>{project.ownership}</small>
              </span>
              <button
                type="button"
                onClick={() => void select(project.id)}
                className={project.id === activeId ? 'button-success' : 'button-secondary'}
                disabled={busy}
              >
                {project.id === activeId ? 'Continue' : 'Open'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="project-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => setShowBrowser((visible) => !visible)}
        >
          {showBrowser ? 'Hide project finder' : 'Find or initialize a project'}
        </button>
      </div>
      {showBrowser && (
        <LocalProjectPicker
          api={props.api}
          onClose={() => setShowBrowser(false)}
          onOpened={async (project) => {
            await props.api.selectProject(project.id);
            await refresh();
            await props.onProjectChanged?.();
            props.onProjectOpened?.();
            setShowBrowser(false);
          }}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
