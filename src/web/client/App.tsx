import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createApiClient, createRequestId, type Task } from './api.js';

export function App(): ReactElement {
  const api = useMemo(() => createApiClient(), []);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState(() => getTaskFromHash());

  useEffect(() => {
    void api
      .session()
      .then((session) => {
        setAuthenticated(session.authenticated);
        setChecking(false);
        if (session.authenticated) void refreshTasks();
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
            await refreshTasks();
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      />
    );
  }

  const selected = tasks.find((task) => task.id === selectedId);
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
      <section className="workspace-grid">
        <TaskList tasks={tasks} onRefresh={refreshTasks} />
        {selected ? (
          <TaskPanel task={selected} api={api} onRefresh={refreshTasks} />
        ) : (
          <p>Select a task to continue.</p>
        )}
      </section>
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<string>();
  const submit = async (): Promise<void> => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      const result = await props.api.execute(props.task.id, {
        schemaVersion: 1,
        requestId: createRequestId(),
        contractId: props.task.id,
        expectedRevision: props.task.revision,
        expectedPreparationRevision: 1,
        kind: 'reply',
        message,
        sourceIds: [],
      });
      setOperation(result.status);
      setMessage('');
      await props.onRefresh();
    } catch (cause) {
      setOperation(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="task-panel">
      <p className="eyebrow">
        {props.task.phase} · revision {props.task.revision}
      </p>
      <h2>Task {props.task.id}</h2>
      <p>
        Readiness: <strong>{props.task.readiness}</strong>
      </p>
      <p>Brief version {props.task.brief.version}. Plans and TODOs remain versioned artifacts.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="task-message">Preparation message</label>
        <textarea
          id="task-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !message.trim()}>
          {busy ? 'Sending...' : 'Send message'}
        </button>
      </form>
      {operation && <p role="status">Operation: {operation}</p>}
    </section>
  );
}

function getTaskFromHash(): string | undefined {
  const value = window.location.hash.slice(1);
  return value || undefined;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request failed';
}
