import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createApiClient, type LauncherSettings, type ProjectSummary, type Task } from './api.js';
import { Setup } from './Setup.js';
import { Settings } from './Settings.js';
import { Projects } from './Projects.js';
import { Devices } from './Devices.js';
import { TransferWizard } from './TransferWizard.js';
import { TaskCreate } from './TaskCreate.js';
import { TaskPreparation } from './TaskPreparation.js';
import { ProjectAgents } from './ProjectAgents.js';

export function App(): ReactElement {
  const api = useMemo(() => createApiClient(), []);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<LauncherSettings>();
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [selectedId, setSelectedId] = useState(() => getTaskFromHash());

  useEffect(() => {
    void api
      .session()
      .then((session) => {
        setAuthenticated(session.authenticated);
        setChecking(false);
        if (session.authenticated) void refreshWorkspace();
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setChecking(false);
      });
  }, [api]);

  useEffect(() => {
    const onHash = () => setSelectedId(getTaskFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function refreshTasks(): Promise<void> {
    try {
      setTasks(await api.listTasks());
      setError(undefined);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function refreshWorkspace(): Promise<void> {
    try {
      const nextSettings = await api.getSettings();
      setSettings(nextSettings);
      if (nextSettings.setupRequired) {
        setActiveProject(null);
        setTasks([]);
        return;
      }
      const nextActiveProject = await api.getActiveProject();
      setActiveProject(nextActiveProject);
      setShowWorkspace(false);
      if (nextActiveProject) await refreshTasks();
      else setTasks([]);
    } catch {
      setSettings(undefined);
      setActiveProject(null);
      await refreshTasks();
    }
  }

  if (checking)
    return (
      <main className="app-shell">
        <p>Loading workspace...</p>
      </main>
    );
  if (!authenticated) {
    return (
      <Login
        code={code}
        setCode={setCode}
        error={error}
        onSubmit={async () => {
          try {
            const session = await api.login(code);
            setAuthenticated(session.authenticated);
            setCode('');
            setError(undefined);
            await refreshWorkspace();
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      />
    );
  }

  const selected = tasks.find((task) => task.id === selectedId);
  const workspaceReady = activeProject !== null || settings === undefined;
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Personal workflow workspace</p>
          <h1>Binaflow</h1>
        </div>
        <button
          type="button"
          onClick={async () => {
            await api.logout();
            setAuthenticated(false);
            setSettings(undefined);
            setActiveProject(null);
            setShowWorkspace(false);
            setShowSettings(false);
            setShowAgents(false);
          }}
        >
          Log out
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {settings?.setupRequired ? (
        <Setup
          api={api}
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            void refreshWorkspace();
          }}
        />
      ) : (
        <div className="app-content">
          <div className="app-toolbar">
            <div className="app-toolbar-brand">
              <strong>{showWorkspace ? activeProject?.name : 'Binaflow'}</strong>
              <span>{showWorkspace ? 'Project workspace' : 'Choose a project to begin'}</span>
            </div>
            <div className="app-toolbar-actions">
              {showWorkspace && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setShowWorkspace(false)}
                >
                  ← Projects
                </button>
              )}
              {showWorkspace && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setShowAgents(true)}
                >
                  Agents
                </button>
              )}
              {settings && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setShowSettings(true)}
                >
                  Server settings
                </button>
              )}
            </div>
          </div>
          {showAgents && showWorkspace && (
            <div
              className="modal-backdrop"
              role="presentation"
              onMouseDown={() => setShowAgents(false)}
            >
              <section
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-settings-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <ProjectAgents api={api} onClose={() => setShowAgents(false)} />
              </section>
            </div>
          )}
          {showSettings && settings && (
            <div
              className="modal-backdrop"
              role="presentation"
              onMouseDown={() => setShowSettings(false)}
            >
              <section
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="modal-heading">
                  <div>
                    <p className="eyebrow">Configuration</p>
                    <h2 id="settings-modal-title">Server settings</h2>
                  </div>
                  <button
                    className="button-secondary"
                    type="button"
                    aria-label="Close settings"
                    onClick={() => setShowSettings(false)}
                  >
                    Close
                  </button>
                </div>
                <Settings api={api} settings={settings} onSaved={setSettings} />
              </section>
            </div>
          )}
          {!showWorkspace && settings && (
            <section className="landing-panel" aria-labelledby="landing-title">
              <p className="eyebrow">Binaflow workspace</p>
              <h2 id="landing-title">What are we working on?</h2>
              <p className="landing-copy">
                Continue with a project or find one in your local project locations.
              </p>
              {tasks.length > 0 && (
                <section className="recent-tasks" aria-labelledby="recent-tasks-title">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Continue where you left off</p>
                      <h3 id="recent-tasks-title">Recent tasks</h3>
                    </div>
                    <span className="muted">{activeProject?.name ?? 'Current project'}</span>
                  </div>
                  <ul>
                    {tasks.slice(0, 5).map((task) => (
                      <li key={task.id}>
                        <div>
                          <strong>Task {task.id.slice(0, 8)}</strong>
                          <small>
                            {task.phase} · {task.readiness}
                          </small>
                        </div>
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => {
                            window.location.hash = task.id;
                            setShowWorkspace(true);
                          }}
                        >
                          Open task
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <Projects
                key={settings.projectRoots.map((root) => root.id).join(':')}
                api={api}
                onProjectChanged={refreshWorkspace}
                onProjectOpened={() => setShowWorkspace(true)}
              />
            </section>
          )}
          {!showWorkspace && !workspaceReady && (
            <div className="empty-state" role="status">
              <strong>No project is open.</strong>
              <p>Complete step 1 before creating or running tasks.</p>
            </div>
          )}
          {showWorkspace && workspaceReady && (
            <section className="flow-section" aria-labelledby="task-step-title">
              <div className="flow-heading">
                <span className="step-number">2</span>
                <div>
                  <p className="eyebrow">Objective</p>
                  <h2 id="task-step-title">Create or continue a task</h2>
                  <p>Tasks move through brief, plan, TODO, execution, and review.</p>
                </div>
              </div>
              <TaskCreate
                api={api}
                onCreated={async (task) => {
                  window.location.hash = task.id;
                  await refreshTasks();
                }}
              />
              <section className="workspace-grid">
                <TaskList tasks={tasks} onRefresh={refreshTasks} />
                {selected ? (
                  <TaskPanel task={selected} api={api} onRefresh={refreshTasks} />
                ) : (
                  <div className="empty-state compact">
                    <strong>Select a task</strong>
                    <p>Choose one from the list to prepare and execute it.</p>
                  </div>
                )}
              </section>
            </section>
          )}
          {showWorkspace && settings && (
            <details className="advanced-tools">
              <summary>Advanced: devices and project handoff</summary>
              <p className="muted">
                Pairing and handoff are separate from the local task workflow.
              </p>
              <div className="tools-grid">
                <Devices api={api} />
                <TransferWizard api={api} />
              </div>
            </details>
          )}
        </div>
      )}
    </main>
  );
}

function Login(props: {
  code: string;
  setCode: (value: string) => void;
  error?: string | undefined;
  onSubmit: () => Promise<void>;
}): ReactElement {
  return (
    <main className="login-card">
      <p className="eyebrow">Local access</p>
      <h1>Sign in to Binaflow</h1>
      <p>Enter the access code printed by the local server.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSubmit();
        }}
      >
        <label htmlFor="access-code">Access code</label>
        <input
          id="access-code"
          type="password"
          value={props.code}
          onChange={(event) => props.setCode(event.target.value)}
          autoComplete="off"
        />
        <button type="submit">Continue</button>
      </form>
      {props.error && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
    </main>
  );
}

function TaskList(props: { tasks: Task[]; onRefresh: () => Promise<void> }): ReactElement {
  return (
    <aside className="task-list">
      <div className="section-heading">
        <h2>Tasks</h2>
        <button type="button" onClick={() => void props.onRefresh()}>
          Refresh
        </button>
      </div>
      {props.tasks.length === 0 ? (
        <p>No tasks yet.</p>
      ) : (
        <ul>
          {props.tasks.map((task) => (
            <li key={task.id}>
              <a href={`#${task.id}`}>
                {task.phase}: {task.id.slice(0, 8)}
              </a>
              <span>{task.readiness}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function TaskPanel(props: {
  task: Task;
  api: ReturnType<typeof createApiClient>;
  onRefresh: () => Promise<void>;
}): ReactElement {
  return <TaskPreparation api={props.api} task={props.task} onRefresh={props.onRefresh} />;
}

function getTaskFromHash(): string | undefined {
  const value = window.location.hash.slice(1);
  return value || undefined;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request failed';
}
