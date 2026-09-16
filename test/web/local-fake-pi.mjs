/* global process */

import { writeFileSync } from 'node:fs';

let buffer = '';

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function outputForName() {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf('--name');
  const name = nameIndex >= 0 ? (args[nameIndex + 1] ?? '') : '';
  if (name.includes('generate-plan')) {
    return {
      schemaVersion: 1,
      kind: 'plan',
      plan: {
        briefVersion: 2,
        summary: 'Deterministic fixture plan',
        items: [
          {
            id: 'fixture-item',
            title: 'Inspect the fixture',
            description: 'Validate the local task flow.',
            files: [{ path: 'fixture-output.txt', reason: 'Fixture output' }],
            acceptanceCriteria: ['The local flow is visible'],
          },
        ],
        verification: ['true'],
      },
      citedSourceIds: [],
    };
  }
  if (name.includes('generate-todo')) {
    return {
      schemaVersion: 1,
      kind: 'todo',
      todo: {
        planVersion: 1,
        phases: [
          {
            id: 'fixture-phase',
            title: 'Fixture phase',
            tasks: [
              {
                id: 'fixture-task',
                planItemId: 'fixture-item',
                instructions: ['Inspect the fixture'],
                files: ['fixture-output.txt'],
                acceptanceCriteria: ['The local flow is visible'],
                verification: ['true'],
                stopConditions: ['Stop if the workspace is not clean'],
              },
            ],
          },
        ],
        scopeChanges: [],
      },
      citedSourceIds: [],
    };
  }
  if (name.includes('guided-')) {
    writeFileSync('fixture-output.txt', 'deterministic fixture output\n');
    return {
      decision: 'done',
      summary: 'Fixture execution completed',
      files: [],
      evidence: [{ criterion: 'fixture', passed: true, details: 'deterministic' }],
    };
  }
  return {
    schemaVersion: 1,
    kind: 'message',
    message: 'Fixture response',
    questions: [],
    citedSourceIds: [],
  };
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'get_commands') {
      write({
        id: command.id,
        type: 'response',
        command: 'get_commands',
        success: true,
        data: { commands: [] },
      });
    } else if (command.type === 'prompt') {
      write({ id: command.id, type: 'response', command: 'prompt', success: true });
      write({
        type: 'message_end',
        message: { content: [{ type: 'text', text: JSON.stringify(outputForName()) }] },
      });
      write({ type: 'agent_settled' });
    } else if (command.type === 'get_state') {
      write({
        id: command.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: { sessionId: 'fixture-session' },
      });
    } else if (command.type === 'get_session_stats') {
      write({
        id: command.id,
        type: 'response',
        command: 'get_session_stats',
        success: true,
        data: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
      });
    } else {
      write({ id: command.id, type: 'response', command: command.type, success: true });
    }
    index = buffer.indexOf('\n');
  }
});
