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
    try {
      const active = await props.api.selectProject(projectId);
      setActiveId(active.id);
      setError(undefined);
      await props.onProjectChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not select project');
    }
  }

  return (
    <section className="projects-panel" aria-labelledby="projects-title">
      <div className="section-heading">
        <h2 id="projects-title">Projects</h2>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {projects.length === 0 ? (
        <p>No projects registered.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <span>
                {project.name} ({project.ownership})
              </span>
              <button
                type="button"
                onClick={() => void select(project.id)}
                disabled={project.id === activeId}
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
