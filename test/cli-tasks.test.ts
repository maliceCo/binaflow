import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GuidedTaskDetailView,
  GuidedTaskSummaryView,
} from '../src/application/guided-task-view.js';
import { createCli } from '../src/cli/index.js';
import { printGuidedTaskDetail, printGuidedTaskList } from '../src/cli/commands/tasks.js';

const taskId = 'task-1';

describe('guided task CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits an empty versioned JSON page without exposing storage details', async () => {
    const directory = createConfigDirectory();
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--json', 'tasks']);
      expect(JSON.parse(output)).toEqual({
        protocol: 'binaflow-cli',
        version: 1,
        type: 'result',
        command: 'tasks',
        data: { items: [] },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects JSONL before opening storage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-guided-task-jsonl-'));
    try {
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--jsonl', 'tasks']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports an unknown task detail without changing storage', async () => {
    const directory = createConfigDirectory();
    try {
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--cwd', directory, 'task', 'missing']),
      ).rejects.toThrow('Task contract does not exist');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('renders populated views with terminal-safe human text', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.join(' '));
    });
    const escape = String.fromCharCode(27);
    const summary: GuidedTaskSummaryView = {
      id: `${escape}[31mtask${escape}[0m`,
      revision: 2,
      readiness: 'needs-plan',
      phase: 'exploration',
      brief: {
        id: 'brief-1',
        contractId: taskId,
        kind: 'brief',
        version: 1,
        sourceDocumentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      plan: null,
      approvedPlan: null,
      todo: null,
    };
    const detail: GuidedTaskDetailView = {
      ...summary,
      id: taskId,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      contractVersion: 1,
      brief: {
        ...summary.brief,
        body: {
          objective: `${escape}[31munsafe${escape}[0m objective`,
          conclusions: [],
          constraints: [],
          outOfScope: [],
        },
      },
      plan: null,
      approvedPlan: null,
      todo: null,
      actions: { items: [] },
      preparation: null,
      execution: null,
    };

    printGuidedTaskList({ items: [summary] });
    printGuidedTaskDetail(detail);

    const text = output.join('\n');
    expect(text).toContain('task');
    expect(text).toContain('unsafe objective');
    expect(text).not.toContain(escape);
  });
});

function createConfigDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-guided-task-'));
  mkdirSync(join(directory, '.binaflow'));
  writeFileSync(
    join(directory, '.binaflow', 'config.json'),
    JSON.stringify({ dataDir: './data', profiles: {} }),
  );
  return directory;
}
