import type { GuidedTaskDetailView } from '../../application/guided-task-view.js';
import { ScreenFrame, SafeText } from '../components.js';

export function GuidedTaskScreen({
  colors,
  task,
  offset,
  visibleRows,
  status,
}: {
  colors: boolean;
  task?: GuidedTaskDetailView;
  offset: number;
  visibleRows: number;
  status?: string;
}) {
  const lines = task ? detailLines(task) : ['Loading guided task...'];
  const visible = lines.slice(offset, offset + Math.max(1, visibleRows));
  return (
    <ScreenFrame
      title="Guided task"
      subtitle="Canonical application view (read-only)"
      status={status}
      footer="j/k scroll | r refresh | q back"
      colors={colors}
      border={false}
    >
      {visible.map((line, index) => (
        <SafeText key={`${offset + index}-${line}`}>{line}</SafeText>
      ))}
    </ScreenFrame>
  );
}

function detailLines(task: GuidedTaskDetailView): string[] {
  const lines = [
    `Task ${task.id}`,
    `phase=${task.phase}  readiness=${task.readiness}  revision=${task.revision}`,
    `brief v${task.brief.version}: ${task.brief.body.objective}`,
    `plan=${documentVersion(task.plan)}  approved-plan=${documentVersion(task.approvedPlan)}  todo=${documentVersion(task.todo)}`,
  ];
  if (task.plan) {
    lines.push(`plan summary: ${task.plan.body.summary}`);
    for (const item of task.plan.body.items) lines.push(`  plan item: ${item.title}`);
  }
  if (task.todo) {
    for (const phase of task.todo.body.phases) {
      lines.push(`todo phase: ${phase.title} (${phase.tasks.length} task(s))`);
    }
  }
  if (task.preparation) {
    lines.push(
      `preparation revision=${task.preparation.revision}  messages=${task.preparation.messages.items.length}  sources=${task.preparation.sources.items.length}`,
    );
    for (const message of task.preparation.messages.items.slice(-5)) {
      lines.push(`message #${message.sequence} ${message.role}: ${message.content}`);
    }
    for (const source of task.preparation.sources.items.slice(-5)) {
      lines.push(`source #${source.sequence} ${source.kind}: ${source.title} (${source.url})`);
    }
  } else {
    lines.push('preparation: not started');
  }
  if (task.execution) {
    lines.push(
      `execution ${task.execution.runId}: ${task.execution.status}  stage=${task.execution.stage}  next=${task.execution.nextAction}`,
    );
    for (const phase of task.execution.phases) {
      lines.push(`phase ${phase.id}: ${phase.status}`);
      for (const executionTask of phase.tasks) {
        lines.push(`  task ${executionTask.id}: ${executionTask.status}`);
      }
    }
    if (task.execution.activeBlock) {
      lines.push(`block ${task.execution.activeBlock.type}: ${task.execution.activeBlock.reason}`);
      if (task.execution.activeBlock.fingerprint) {
        lines.push(
          `workspace changes: ${task.execution.activeBlock.fingerprint.changes.length}  clean=${task.execution.activeBlock.fingerprint.clean}`,
        );
      }
    }
  } else {
    lines.push('execution: not started');
  }
  lines.push(`next: ${nextLimitation(task)}`);
  return lines;
}

function documentVersion(document: { version: number } | null): string {
  return document ? `v${document.version}` : 'missing';
}

function nextLimitation(task: GuidedTaskDetailView): string {
  switch (task.readiness) {
    case 'blocked':
      return 'resolve the active block in the web interface';
    case 'needs-plan':
      return 'prepare a plan in the web interface';
    case 'needs-approval':
      return 'approve the plan in the web interface';
    case 'needs-todo':
      return 'prepare the TODO in the web interface';
    case 'ready':
      return task.execution
        ? 'observe the active execution'
        : 'start execution in the web interface';
  }
}
