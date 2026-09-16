import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskCreate } from '../src/web/client/TaskCreate.js';
import { TaskPreparation } from '../src/web/client/TaskPreparation.js';
import type { ApiClient, Task } from '../src/web/client/api.js';

const task: Task = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  revision: 1,
  readiness: 'needs-plan',
  phase: 'exploration',
  brief: { id: 'brief', version: 1, createdAt: '2025-01-01T00:00:00.000Z' },
  plan: null,
  approvedPlan: null,
  todo: null,
};

describe('local task client', () => {
  it('renders task creation and preparation controls without server paths', () => {
    const api = {} as ApiClient;
    const html = renderToStaticMarkup(
      <>
        <TaskCreate api={api} onCreated={async () => undefined} />
        <TaskPreparation api={api} task={task} onRefresh={async () => undefined} />
      </>,
    );
    expect(html).toContain('Create task');
    expect(html).toContain('Task 123e4567-e89b-42d3-a456-426614174000');
    expect(html).toContain('Loading preparation...');
    expect(html).not.toContain('/mnt/');
  });
});
