import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClient, Task } from './api.js';

export function TaskCreate(props: {
  api: ApiClient;
  onCreated: (task: Task) => Promise<void>;
}): ReactElement {
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create(): Promise<void> {
    if (busy || !objective.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const task = await props.api.createTask(objective);
      setObjective('');
      await props.onCreated(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The task could not be created');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="task-create" aria-labelledby="task-create-title">
      <h2 id="task-create-title">New task</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label htmlFor="task-objective">Objective</label>
        <textarea
          id="task-objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !objective.trim()}>
          {busy ? 'Creating...' : 'Create task'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
