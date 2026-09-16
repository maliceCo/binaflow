import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, ProjectSummary } from './api.js';
import { ProjectBrowser } from './ProjectBrowser.js';

export function Projects(props: {
  api: ApiClient;
  onProjectChanged?: () => Promise<void>;
}): ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not select project');
    } finally {
      setBusy(false);
    }
  }

  async function close(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await props.api.closeActiveProject();
      setActiveId(undefined);
      setError(undefined);
      await props.onProjectChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="projects-panel panel" aria-labelledby="projects-title">
      <div className="section-heading">
        <h2 id="projects-title">Projects</h2>
        <div className="button-row">
          {activeId && (
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={() => void close()}
            >
              Close active project
            </button>
          )}
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
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
                disabled={busy || project.id === activeId}
              >
                {project.id === activeId ? 'Active' : 'Open'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ProjectBrowser
        api={props.api}
        onRegistered={async () => {
          await refresh();
          await props.onProjectChanged?.();
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
