import { describe, expect, it } from 'vitest';
import { CliEventPresenter } from '../src/cli/commands/common.js';

describe('CLI event presentation', () => {
  it('streams agent messages while keeping status and tool activity readable', () => {
    let output = '';
    const presenter = new CliEventPresenter(false, (text) => {
      output += text;
    });

    presenter.present(event('status', 'Step plan started'));
    presenter.present(event('text', 'hello '));
    presenter.present(event('text', 'world'));
    presenter.present(event('status', 'Pi tool_execution_start tool=read id=call-1'));
    presenter.present(event('error', 'The tool failed'));
    presenter.flush();

    expect(output).toBe(
      '[plan] started\n' +
        '[plan] agent: hello world\n' +
        '[plan] tool started tool=read id=call-1\n' +
        '[plan] error: The tool failed\n',
    );
  });

  it('preserves protocol detail in verbose mode', () => {
    let output = '';
    const presenter = new CliEventPresenter(true, (text) => {
      output += text;
    });

    presenter.present(event('text', 'hello'));
    presenter.present(event('status', 'Step plan completed'));

    expect(output).toBe('hello\n[plan] status: Step plan completed\n');
  });
});

function event(type: 'status' | 'text' | 'error', message: string) {
  return {
    runId: 'run-1',
    stepId: 'plan',
    type,
    message,
    occurredAt: '2026-01-01T00:00:00.000Z',
  } as const;
}
