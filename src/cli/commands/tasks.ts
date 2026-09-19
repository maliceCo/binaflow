import type { Command } from 'commander';
import type {
  GuidedTaskDetailView,
  GuidedTaskSummaryPage,
  GuidedTaskSummaryView,
} from '../../application/guided-task-view.js';
import {
  cliUsageError,
  machineMode,
  rejectUnsupportedJsonl,
  writeJsonResult,
} from '../protocol.js';
import { formatTimestamp } from '../../presentation/format.js';
import { sanitizeTerminalText } from '../../presentation/text.js';

interface TaskListOptions {
  limit?: string;
  cursor?: string;
}

export function registerTaskCommands(cli: Command): void {
  cli
    .command('tasks')
    .description('List guided tasks')
    .option('--limit <number>', 'maximum number of tasks to return (1-100)')
    .option('--cursor <cursor>', 'continue after a previous page')
    .action(async (options: TaskListOptions, command: Command) => {
      const { openStorageContext, rootOptions } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      rejectUnsupportedJsonl(mode, 'tasks');
      const context = await openStorageContext(optionsAtRoot);
      try {
        const listGuidedTaskViews = context.application.listGuidedTaskViews;
        if (!listGuidedTaskViews) throw new Error('Guided task inspection is unavailable');
        const page = await listGuidedTaskViews({
          ...(options.cursor !== undefined ? { afterId: options.cursor } : {}),
          ...(options.limit !== undefined ? { limit: parseLimit(options.limit) } : {}),
        });
        if (mode === 'json') {
          writeJsonResult('tasks', page);
          return;
        }
        printGuidedTaskList(page);
      } finally {
        context.close();
      }
    });

  cli
    .command('task <taskId>')
    .description('Show a guided task')
    .action(async (taskId: string, _options: unknown, command: Command) => {
      const { openStorageContext, rootOptions } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      rejectUnsupportedJsonl(mode, 'task');
      const context = await openStorageContext(optionsAtRoot);
      try {
        const getGuidedTaskView = context.application.getGuidedTaskView;
        if (!getGuidedTaskView) throw new Error('Guided task inspection is unavailable');
        const view = await getGuidedTaskView(taskId);
        if (mode === 'json') {
          writeJsonResult('task', view);
          return;
        }
        printGuidedTaskDetail(view);
      } finally {
        context.close();
      }
    });
}

export function printGuidedTaskList(page: GuidedTaskSummaryPage): void {
  if (page.items.length === 0) {
    console.log('No guided tasks found. Create one from the web interface.');
    return;
  }
  console.log(
    'TASK ID                                  PHASE        READINESS      DOCUMENTS  EXECUTION',
  );
  for (const task of page.items) {
    const documents = [
      `brief:v${task.brief.version}`,
      ...(task.plan ? [`plan:v${task.plan.version}`] : []),
      ...(task.approvedPlan ? [`approved:v${task.approvedPlan.version}`] : []),
      ...(task.todo ? [`todo:v${task.todo.version}`] : []),
    ].join(',');
    console.log(
      `${singleLine(task.id, 40).padEnd(40)}  ${task.phase.padEnd(12)} ${task.readiness.padEnd(14)} ${documents.padEnd(20)} ${task.executionRunId ? `run:${singleLine(task.executionRunId, 24)}` : '-'}`,
    );
  }
  if (page.nextCursor) console.log(`NEXT CURSOR  ${singleLine(page.nextCursor, 120)}`);
}

export function printGuidedTaskDetail(view: GuidedTaskDetailView): void {
  console.log(`Task ${singleLine(view.id, 160)}`);
  console.log(`  phase=${view.phase}  readiness=${view.readiness}  revision=${view.revision}`);
  console.log(
    `  created=${formatTimestamp(view.createdAt)}  updated=${formatTimestamp(view.updatedAt)}`,
  );
  console.log(
    `  brief=v${view.brief.version}  objective=${singleLine(view.brief.body.objective, 240)}`,
  );
  console.log(
    `  plan=${documentVersion(view.plan)}  approved-plan=${documentVersion(view.approvedPlan)}`,
  );
  console.log(`  todo=${documentVersion(view.todo)}`);

  if (view.preparation) {
    const preparation = view.preparation;
    console.log(
      `  preparation=revision ${preparation.revision}  messages=${preparation.messages.items.length}  sources=${preparation.sources.items.length}  last-sequence=${preparation.lastSequence}`,
    );
    for (const message of preparation.messages.items.slice(-3)) {
      console.log(
        `    message#${message.sequence} ${message.role}: ${singleLine(message.content, 240)}`,
      );
    }
  } else {
    console.log('  preparation=not-started');
  }

  if (view.execution) {
    console.log(
      `  execution=run ${singleLine(view.execution.runId, 80)}  status=${view.execution.status}  stage=${view.execution.stage}  next=${view.execution.nextAction}`,
    );
    for (const phase of view.execution.phases) {
      console.log(`    phase=${singleLine(phase.id, 80)}  status=${phase.status}`);
      for (const task of phase.tasks) {
        console.log(`      task=${singleLine(task.id, 80)}  status=${task.status}`);
      }
    }
    if (view.execution.changeSet) {
      console.log(
        `    change-set=${singleLine(view.execution.changeSet.id, 80)}  revision=${view.execution.changeSet.revision}  status=${view.execution.changeSet.status}  files=${view.execution.changeSet.files.length}`,
      );
      for (const file of view.execution.changeSet.files) {
        console.log(
          `      ${file.status} ${singleLine(file.path, 160)}  hunks=${file.hunks.length}`,
        );
      }
    }
  } else {
    console.log('  execution=not-started');
  }

  console.log(`  next=${nextLimitation(view)}`);
}

function documentVersion(document: { version: number } | null): string {
  return document ? `v${document.version}` : 'missing';
}

function nextLimitation(view: GuidedTaskDetailView | GuidedTaskSummaryView): string {
  switch (view.readiness) {
    case 'blocked':
      return 'resolve the active block in the web interface';
    case 'needs-plan':
      return 'prepare a plan in the web interface';
    case 'needs-approval':
      return 'approve the plan in the web interface';
    case 'needs-todo':
      return 'prepare the TODO in the web interface';
    case 'ready':
      return view.executionRunId
        ? 'observe the active execution'
        : 'start execution from the web interface';
  }
}

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw cliUsageError('INVALID_LIMIT', 'The tasks limit must be an integer between 1 and 100');
  }
  return limit;
}

function singleLine(value: string, maxLength: number): string {
  const normalized = sanitizeTerminalText(value).replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
