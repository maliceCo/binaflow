import { describe, expect, it } from 'vitest';
import { discoverWorkflows } from '../src/application/operations.js';
import type { RunView } from '../src/application/run-view.js';
import type { ConfigurationDiagnosis } from '../src/application/config-operations.js';
import type { LaunchInputState } from '../src/tui/launch.js';
import type { TuiEvent, TuiState } from '../src/tui/model.js';
import { createInitialTuiState } from '../src/tui/model.js';
import { reduce } from '../src/tui/reduce.js';

const CWD = '/workspaces/demo';
const CONFIG_PATH = '.binaflow/config.json';

interface Transition {
  name: string;
  events: TuiEvent[];
  expect: (state: TuiState) => void;
}

const transitions: Transition[] = [
  {
    name: 'starts on the welcome overlay with the cwd from --cwd',
    events: [],
    expect: (state) => {
      expect(state.overlay).toBe('welcome');
      expect(state.cwd).toBe(CWD);
      expect(state.detail).toBe('empty');
      expect(state.focus).toBe('workflows');
    },
  },
  {
    name: 'welcome Use this folder on a new folder opens setup and requests model discovery',
    events: [diagnosed(missingConfig()), useFolder()],
    expect: (state) => {
      expect(state.overlay).toBe('setup');
      expect(state.effect).toBe('discover-setup-models');
      expect(state.setupStep).toBe(1);
    },
  },
  {
    name: 'welcome Use this folder with an existing config opens the studio',
    events: [diagnosed(validConfig()), useFolder()],
    expect: (state) => {
      expect(state.overlay).toBe('none');
      expect(state.detail).toBe('diagnosis');
      expect(state.focus).toBe('workflows');
    },
  },
  {
    name: 'setup q cancels without saving and returns to welcome with values cleared',
    events: [diagnosed(missingConfig()), useFolder(), { type: 'setup-cancel' }],
    expect: (state) => {
      expect(state.overlay).toBe('welcome');
      expect(state.setupValues).toEqual({});
      expect(state.setupStep).toBe(1);
      expect(state.effect).toBeUndefined();
    },
  },
  {
    name: 'setup review Go back returns to the previous field, not welcome',
    events: [diagnosed(missingConfig()), useFolder(), ...nextToReview(), { type: 'setup-back' }],
    expect: (state) => {
      expect(state.overlay).toBe('setup');
      expect(state.setupStep).toBe(3);
      expect(state.setupField).toBe(4);
    },
  },
  {
    name: 'live cancel-requested marks cancellation without leaving the live panel',
    events: [diagnosed(validConfig()), useFolder(), runStarted(), { type: 'cancel-requested' }],
    expect: (state) => {
      expect(state.detail).toBe('live');
      expect(state.overlay).toBe('none');
      expect(state.cancellationRequested).toBe(true);
    },
  },
  {
    name: 'opening a run waits for RunView before selecting a detail mode',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      { type: 'open-run', runId: 'run-9', status: 'waiting' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('inspect');
      expect(state.activeRunId).toBe('run-9');
      expect(state.overlay).toBe('none');
    },
  },
  {
    name: 'leaving a waiting run shows inspect in the right panel, not a history screen',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      { type: 'open-run', runId: 'run-9', status: 'waiting' },
      { type: 'leave-waiting' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('inspect');
      expect(state.activeRunId).toBe('run-9');
      expect(state.overlay).toBe('none');
    },
  },
  {
    name: 'opening the folder picker is ignored while a run is live',
    events: [diagnosed(validConfig()), useFolder(), runStarted(), { type: 'open-folder-picker' }],
    expect: (state) => {
      expect(state.overlay).toBe('none');
      expect(state.detail).toBe('live');
    },
  },
  {
    name: 'opening the folder picker when idle opens the picker overlay',
    events: [diagnosed(validConfig()), useFolder(), { type: 'open-folder-picker' }],
    expect: (state) => {
      expect(state.overlay).toBe('folder-picker');
      expect(state.folderPickerPath).toBe(CWD);
      expect(state.folderPickerOrigin).toBe('studio');
    },
  },
  {
    name: 'an invalid config cannot start a new run',
    events: [diagnosed(invalidConfig()), useFolder(), { type: 'new-run' }],
    expect: (state) => {
      expect(state.detail).not.toBe('launch');
      expect(state.error).toContain('config file is invalid');
    },
  },
  {
    name: 'j/k moves the welcome selection',
    events: [{ type: 'move', direction: 1, visibleRows: 10 }],
    expect: (state) => {
      expect(state.overlay).toBe('welcome');
      expect(state.selection).toBe(1);
    },
  },
  {
    name: 'opening artifacts shows the artifact browser in the detail pane',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      { type: 'open-run', runId: 'run-9', status: 'completed' },
      inspectionSet(),
      { type: 'open-artifacts' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('artifacts');
      expect(state.runView?.id).toBe('run-9');
    },
  },
  {
    name: 'new run with revised objective pre-fills the launch input',
    events: [diagnosed(validConfig()), useFolder(), inspectionSet(), { type: 'open-launch' }],
    expect: (state) => {
      expect(state.detail).toBe('launch');
      expect(state.launchInput?.values.objective).toBe('Build the CLI');
      expect(state.launchInput?.field).toBe(0);
    },
  },
  {
    name: 'finishing a live run keeps the same run in the result panel',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      runStarted(),
      { type: 'run-finished', status: 'completed' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('result');
      expect(state.activeRunId).toBe('run-1');
    },
  },
  {
    name: 'a required launch input rejects an empty objective',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      { type: 'launch-set', input: launchInput() },
      { type: 'launch-input', value: ' ' },
    ],
    expect: (state) => {
      expect(state.launchInput?.field).toBe(0);
      expect(state.launchInput?.error).toBe('objective is required.');
    },
  },
  {
    name: 'setup save waits for a generated preview and stays in setup',
    events: [diagnosed(missingConfig()), useFolder(), { type: 'setup-save' }],
    expect: (state) => {
      expect(state.overlay).toBe('setup');
      expect(state.effect).toBe('discover-setup-models');
      expect(state.error).toBe('Configuration preview is not ready yet.');
    },
  },
  {
    name: 'waiting completion stays in the approval detail',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      runStarted(),
      { type: 'run-finished', status: 'waiting' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('approval');
      expect(state.activeRunId).toBe('run-1');
    },
  },
  {
    name: 'an eligible failed run stays inspectable for recovery',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      runStarted(),
      {
        type: 'run-view-set',
        view: inspectionSetView('failed'),
        clarifications: [],
      },
      { type: 'run-finished', status: 'failed' },
    ],
    expect: (state) => {
      expect(state.detail).toBe('inspect');
      expect(state.activeRunId).toBe('run-1');
      expect(state.runView?.availableActions).toEqual([
        { kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false },
      ]);
    },
  },
  {
    name: 'folder picker Space can confirm the selected child directory',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      { type: 'open-folder-picker' },
      {
        type: 'folder-listed',
        entries: [
          { path: '/workspaces/child', name: 'child', isParent: false, hasBinaflow: false },
        ],
      },
      { type: 'move', direction: 1, visibleRows: 5 },
      { type: 'folder-picker-select', path: '/workspaces/child' },
    ],
    expect: (state) => {
      expect(state.overlay).toBe('folder-confirm');
      expect(state.folderPickerPath).toBe('/workspaces/child');
    },
  },
  {
    name: 'workflow movement keeps a separate viewport offset',
    events: [
      diagnosed(validConfig()),
      useFolder(),
      {
        type: 'workflows-loaded',
        workflows: Array.from({ length: 4 }, (_, index) => ({
          ...discoverWorkflows()[0]!,
          id: `workflow-${index}`,
        })),
      },
      { type: 'move', direction: 1, visibleRows: 2 },
      { type: 'move', direction: 1, visibleRows: 2 },
    ],
    expect: (state) => {
      expect(state.workflowSelected).toBe(2);
      expect(state.workflowOffset).toBe(1);
    },
  },
];

describe('TUI transitions', () => {
  it.each(transitions)('$name', ({ events, expect: check }) => {
    let state = createInitialTuiState({ cwd: CWD, configPath: CONFIG_PATH });
    for (const event of events) state = reduce(state, event);
    check(state);
  });

  it('moves an existing selection offset upward when selection moves up', () => {
    const state = {
      ...createInitialTuiState({ cwd: CWD, configPath: CONFIG_PATH }),
      selection: 3,
      offset: 3,
    };

    expect(reduce(state, { type: 'move', direction: -1, visibleRows: 3 })).toMatchObject({
      selection: 2,
      offset: 1,
    });
  });

  it('starts artifact selection from the selected result step', () => {
    let state = createInitialTuiState({ cwd: CWD, configPath: CONFIG_PATH });
    state = reduce(state, diagnosed(validConfig()));
    state = reduce(state, useFolder());
    state = reduce(state, {
      type: 'run-view-set',
      view: inspectionSetView('completed'),
      clarifications: [],
    });
    state = { ...state, detail: 'result', selection: 1 };

    expect(reduce(state, { type: 'open-artifacts' }).artifactSelected).toBe(1);
  });

  it('clears transient status when authoritative run state arrives', () => {
    const initial = {
      ...createInitialTuiState({ cwd: CWD, configPath: CONFIG_PATH }),
      status: 'Launching...',
    };
    const afterView = reduce(initial, {
      type: 'run-view-set',
      view: inspectionSetView('completed'),
      clarifications: [],
    });
    expect(afterView.status).toBeUndefined();
    expect(
      reduce({ ...initial, detail: 'live' }, { type: 'run-finished', status: 'completed' }).status,
    ).toBeUndefined();
  });
});

function diagnosed(diagnosis: ConfigurationDiagnosis): TuiEvent {
  return { type: 'diagnosed', diagnosis };
}

function useFolder(): TuiEvent {
  return { type: 'use-folder' };
}

function runStarted(): TuiEvent {
  return { type: 'run-started', runId: 'run-1' };
}

function nextToReview(): TuiEvent[] {
  return Array.from({ length: 6 }, () => ({ type: 'setup-next' }));
}

function inspectionSet(): TuiEvent {
  return {
    type: 'run-view-set',
    view: inspectionSetView('completed'),
    clarifications: [],
  };
}

function inspectionSetView(status: 'completed' | 'failed'): RunView {
  return {
    id: 'run-9',
    workflow: { id: 'plan-build', version: 1, installedVersion: 1, compatible: true },
    objective: 'Build the CLI',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T01:00:00Z',
    phases: [
      {
        id: 'plan',
        kind: 'agent',
        profile: 'planner',
        status,
        attempt: 1,
      },
      {
        id: 'build',
        kind: 'agent',
        profile: 'builder',
        status: 'pending',
        attempt: 1,
      },
    ],
    artifacts: [
      {
        id: 'artifact-1',
        stepId: 'build',
        name: 'output.txt',
        kind: 'text',
        mediaType: 'text/plain',
        sizeBytes: 10,
      },
    ],
    eventCount: 0,
    metrics: {},
    availableActions:
      status === 'failed'
        ? [{ kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false }]
        : [],
  };
}

function launchInput(): LaunchInputState {
  const workflow = discoverWorkflows().find((workflow) => workflow.id === 'plan-build');
  if (!workflow) throw new Error('plan-build workflow missing');
  return { workflow, values: {}, field: 0, reviewedProfiles: {} };
}

function missingConfig(): ConfigurationDiagnosis {
  return {
    workspacePath: CWD,
    configPath: `${CWD}/${CONFIG_PATH}`,
    configExists: false,
    configValid: false,
    errors: [],
    profiles: [],
    workflows: [],
    qaHistory: { enabled: false },
    ready: false,
  };
}

function validConfig(): ConfigurationDiagnosis {
  return {
    workspacePath: CWD,
    configPath: `${CWD}/${CONFIG_PATH}`,
    configExists: true,
    configValid: true,
    errors: [],
    profiles: [],
    workflows: [],
    qaHistory: { enabled: false },
    ready: true,
  };
}

describe('TUI detail navigation', () => {
  it('keeps approval and artifact movement in their own selection state', () => {
    const base = createInitialTuiState({ cwd: CWD, configPath: CONFIG_PATH });
    const view = inspectionSetView('completed');
    const approvalView: RunView = {
      ...view,
      status: 'waiting',
      availableActions: [
        {
          kind: 'approve-research',
          stepId: 'research-approval',
          label: 'Approve',
          requiresConfirmation: false,
        },
        {
          kind: 'reject-research',
          stepId: 'research-approval',
          label: 'Reject',
          requiresConfirmation: false,
          requiresFeedback: true,
        },
      ],
    };
    const approvalState = {
      ...base,
      overlay: 'none' as const,
      detail: 'approval' as const,
      focus: 'detail' as const,
      runView: approvalView,
      selection: 0,
      offset: 0,
      artifactSelected: 2,
      artifactOffset: 1,
    };
    const movedApproval = reduce(
      reduce(approvalState, { type: 'move', direction: 1, visibleRows: 10 }),
      { type: 'move', direction: 1, visibleRows: 10 },
    );
    expect(movedApproval.selection).toBe(2);
    expect(movedApproval.artifactSelected).toBe(2);

    const artifactState = {
      ...base,
      overlay: 'none' as const,
      detail: 'artifacts' as const,
      focus: 'detail' as const,
      runView: {
        ...view,
        artifacts: [view.artifacts[0]!, view.artifacts[0]!, view.artifacts[0]!],
      },
      selection: 2,
      offset: 1,
      artifactSelected: 0,
      artifactOffset: 0,
    };
    const movedArtifacts = reduce(
      reduce(artifactState, { type: 'move', direction: 1, visibleRows: 10 }),
      { type: 'move', direction: 1, visibleRows: 10 },
    );
    expect(movedArtifacts.artifactSelected).toBe(2);
    expect(movedArtifacts.selection).toBe(2);
  });
});

function invalidConfig(): ConfigurationDiagnosis {
  return {
    workspacePath: CWD,
    configPath: `${CWD}/${CONFIG_PATH}`,
    configExists: true,
    configValid: false,
    errors: ['Binaflow config requires a profiles object'],
    profiles: [],
    workflows: [],
    qaHistory: { enabled: false },
    ready: false,
  };
}
