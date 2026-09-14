import {
  TaskContractError,
  type TaskContractAction,
  type TaskContractDocument,
  type TaskContractPlan,
  type TaskContractReadiness,
  type TaskContractBrief,
  type TaskContractTodo,
} from './task-contract.js';

export interface RenderTaskContractTodoInput {
  contractId: string;
  brief: TaskContractDocument<TaskContractBrief>;
  plan: TaskContractDocument<TaskContractPlan>;
  todo: TaskContractDocument<TaskContractTodo>;
  readiness: TaskContractReadiness;
  current: boolean;
  approvedPlanId: string | null;
  activeBlock: TaskContractAction | null;
}

const MAX_RENDERED_TODO_BYTES = 256 * 1024;

export function renderTaskContractTodo(input: RenderTaskContractTodoInput): string {
  const executable =
    input.current &&
    input.readiness === 'ready' &&
    input.approvedPlanId === input.plan.id &&
    input.activeBlock === null;
  const planFiles = new Map(
    input.plan.body.items.flatMap((item) =>
      item.files.map((file) => [`${item.id}:${file.path}`, file.reason]),
    ),
  );
  const lines = [
    '# Guided task TODO',
    '',
    '## Contract',
    '',
    `- Contract ID: ${inline(input.contractId)}`,
    `- Brief version: ${inline(String(input.brief.version))}`,
    `- Plan version: ${inline(String(input.plan.version))}`,
    `- TODO version: ${inline(String(input.todo.version))}`,
    `- Readiness: ${inline(input.readiness)}`,
    `- Status: ${inline(executable ? 'READY FOR FUTURE HANDOFF' : 'NO EJECUTAR')}`,
    '',
    ...(executable
      ? []
      : [
          '> **NO EJECUTAR:** esta version no es la vigente y aprobada del contrato, o tiene un bloqueo activo.',
          '',
        ]),
    '## Objective',
    '',
    fenced(input.brief.body.objective),
    '',
    '## Conclusions',
    '',
    fencedList(input.brief.body.conclusions),
    '',
    '## Constraints',
    '',
    fencedList(input.brief.body.constraints),
    '',
    '## Out of scope',
    '',
    fencedList(input.brief.body.outOfScope),
    '',
    '## Plan',
    '',
    fenced(input.plan.body.summary),
    '',
    ...input.todo.body.phases.flatMap((phase) => [
      `## Phase ${inline(phase.id)}: ${inline(phase.title)}`,
      '',
      ...phase.tasks.flatMap((task) => {
        const files = task.files.map(
          (path) =>
            `${path} — ${planFiles.get(`${task.planItemId}:${path}`) ?? 'Reason declared by plan item'}`,
        );
        return [
          `### [ ] ${inline(task.id)} (plan item ${inline(task.planItemId)})`,
          '',
          '#### Instructions',
          '',
          fencedList(task.instructions),
          '',
          '#### Files',
          '',
          fencedList(files),
          '',
          '#### Acceptance criteria',
          '',
          fencedList(task.acceptanceCriteria),
          '',
          '#### Verification',
          '',
          fencedList(task.verification),
          '',
          '#### Stop conditions',
          '',
          fencedList(task.stopConditions),
          '',
        ];
      }),
    ]),
    '## Scope changes',
    '',
    fencedList(input.todo.body.scopeChanges),
    '',
  ];
  const content = lines.join('\n');
  if (Buffer.byteLength(content, 'utf8') > MAX_RENDERED_TODO_BYTES) {
    throw new TaskContractError(
      'invalid-input',
      `Rendered task contract TODO exceeds ${MAX_RENDERED_TODO_BYTES} bytes`,
    );
  }
  return content;
}

function fencedList(values: readonly string[]): string {
  return fenced(values.join('\n'));
}

function fenced(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g)?.map((run) => run.length) ?? []));
  const delimiter = '`'.repeat(Math.max(3, longestRun + 1));
  return `${delimiter}text\n${value}\n${delimiter}`;
}

function inline(value: string): string {
  const normalized = value.replace(/[\r\n]+/g, ' ');
  const longestRun = Math.max(0, ...(normalized.match(/`+/g)?.map((run) => run.length) ?? []));
  const delimiter = '`'.repeat(Math.max(1, longestRun + 1));
  return `${delimiter} ${normalized} ${delimiter}`;
}
