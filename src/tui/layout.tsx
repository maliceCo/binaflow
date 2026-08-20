import { Box } from 'ink';
import type { ReactNode } from 'react';
import type { ConfigurationDiagnosis } from '../application/config-operations.js';
import { humanRunStatus, truncateDisplay } from '../presentation/format.js';
import { AppFrame, Panel, SafeText, SelectionList, StatusBar } from './components.js';
import type { LiveState } from './execution.js';
import { visibleFolderEntries, type FolderEntry, type TuiState } from './model.js';
import { workflowItems } from './screens/workflows.js';
import { BRAND_LOGO } from './brand.js';

const WELCOME_ACTIONS = [
  'Use this folder',
  'Choose a different folder',
  'What is Binaflow?',
  'Quit',
];
const KEYMAP = [
  'n  start a new run',
  'w  choose a different folder (when idle)',
  'd / r  refresh the configuration diagnosis',
  '?  show this help',
  'Tab / h / l  switch the focused pane',
  'j / k / arrows  move the selection or scroll',
  'Enter  activate the selected item',
  'q / Esc  quit when idle, cancel while live, close an overlay',
  'Ctrl-C  cancel while live, quit when idle',
];

export function StudioLayout({
  colors,
  state,
  live,
  liveDetail,
  size,
  right,
}: {
  colors: boolean;
  state: TuiState;
  live?: LiveState;
  liveDetail: boolean;
  size: { columns: number; rows: number };
  right: ReactNode;
}) {
  const ready = state.diagnosis?.ready === true;
  const workflowLabels = workflowItems(state.workflows ?? [], state.diagnosis);
  const runLabels = (state.runs ?? []).map((run) => {
    const status = humanRunStatus(run.status);
    return `${run.id} ${run.workflowId} ${status}  ${truncateDisplay(run.objective, 24)}`;
  });
  const paneRows = Math.max(2, size.rows - 14);
  const workflowsRows = Math.max(1, Math.floor((paneRows - 2) / 2));
  const runsRows = Math.max(1, paneRows - workflowsRows - 2);
  const footer =
    state.detail === 'live'
      ? 'q cancel   Ctrl-C cancel   d activity   j/k scroll'
      : 'n new run   w folder   d status   ? help   Tab switch   q quit';
  return (
    <AppFrame>
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <SafeText bold>{'Binaflow  '}</SafeText>
          <SafeText {...(colors ? { color: ready ? 'green' : 'yellow' } : {})}>
            {ready ? 'Ready' : 'Needs attention'}
          </SafeText>
        </Box>
        <Box>
          <SafeText {...(colors ? { color: 'cyan' as const } : {})}>
            {state.activeRunId ? `active ${state.activeRunId}` : 'idle'}
          </SafeText>
          <SafeText dimColor>
            {' '}
            {truncateDisplay(state.cwd, Math.max(20, size.columns - 60))}
          </SafeText>
        </Box>
      </Box>
      <Box flexDirection="row" flexGrow={1}>
        <Panel
          colors={colors}
          focused={state.focus !== 'detail'}
          width={Math.max(24, Math.floor(size.columns * 0.4))}
        >
          <SafeText bold>Workflows</SafeText>
          {workflowLabels.length > 0 ? (
            <SelectionList
              items={workflowLabels}
              selected={state.workflowSelected}
              offset={state.workflowOffset}
              visibleRows={workflowsRows}
            />
          ) : (
            <SafeText> Loading workflows...</SafeText>
          )}
          <SafeText bold>Runs</SafeText>
          {runLabels.length > 0 ? (
            <SelectionList
              items={runLabels}
              selected={state.runSelected}
              offset={state.runOffset}
              visibleRows={runsRows}
            />
          ) : (
            <SafeText> No runs yet.</SafeText>
          )}
        </Panel>
        <Panel
          colors={colors}
          focused={state.focus === 'detail'}
          flexGrow={1}
          width={`${Math.max(10, size.columns - Math.max(24, Math.floor(size.columns * 0.4)))}`}
        >
          {right}
        </Panel>
      </Box>
      <StatusBar>
        {state.error ? <SafeText color="red">{state.error}</SafeText> : null}
        {state.status ? <SafeText color="cyan">{state.status}</SafeText> : null}
        {live && liveDetail ? <SafeText dimColor>Activity detail</SafeText> : null}
        <SafeText dimColor>{footer}</SafeText>
      </StatusBar>
    </AppFrame>
  );
}

export function WelcomeScreen({
  colors,
  cwd,
  diagnosis,
  selected,
}: {
  colors: boolean;
  cwd: string;
  diagnosis?: ConfigurationDiagnosis;
  selected: number;
}) {
  const status =
    diagnosis?.configExists && diagnosis.ready
      ? 'This folder already has Binaflow.'
      : diagnosis && !diagnosis.configExists
        ? 'New folder. Nothing has been written yet.'
        : 'This folder cannot be used yet.';
  return (
    <AppFrame>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        BINAFLOW
      </SafeText>
      {BRAND_LOGO.map((line) => (
        <SafeText key={line} bold {...(colors ? { color: 'cyan' } : {})}>
          {line}
        </SafeText>
      ))}
      <SafeText>Local workflows for coding agents.</SafeText>
      <SafeText> </SafeText>
      <SafeText dimColor>{cwd}</SafeText>
      <SafeText>{status}</SafeText>
      {!diagnosis?.configValid && diagnosis?.errors[0] ? (
        <SafeText dimColor>{diagnosis.errors[0]}</SafeText>
      ) : null}
      <SafeText> </SafeText>
      <SelectionList items={WELCOME_ACTIONS} selected={selected} offset={0} visibleRows={4} />
    </AppFrame>
  );
}

export function FolderPickerScreen({
  colors,
  entries,
  selected,
  offset,
  path,
  filter,
  visibleRows,
}: {
  colors: boolean;
  entries: FolderEntry[];
  selected: number;
  offset: number;
  path: string;
  filter: string;
  visibleRows: number;
}) {
  const filteredEntries = visibleFolderEntries(entries, filter);
  const parent = filteredEntries.find((entry) => entry.isParent);
  const directories = filteredEntries.filter((entry) => !entry.isParent);
  const items = directories.map((entry) => {
    if (entry.error) return `${entry.isParent ? '..' : entry.name} (${entry.error})`;
    return entry.isParent ? '..' : `${entry.name}${entry.hasBinaflow ? ' [Binaflow]' : ''}`;
  });
  const list = [...(parent ? ['..'] : []), 'Use this folder', ...items];
  return (
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        Choose a folder
      </SafeText>
      <SafeText dimColor>{path}</SafeText>
      <SafeText>Type to filter. Enter opens a folder, Space uses the selected folder.</SafeText>
      <SafeText>Filter: {filter || '(all folders)'}</SafeText>
      <SafeText> </SafeText>
      <SelectionList items={list} selected={selected} offset={offset} visibleRows={visibleRows} />
    </Box>
  );
}

export function FolderConfirmScreen({
  colors,
  path,
  selected,
}: {
  colors: boolean;
  path: string;
  selected: number;
}) {
  return (
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        Use this folder?
      </SafeText>
      <SafeText dimColor>{path}</SafeText>
      <SafeText>Agents may read files in this folder.</SafeText>
      <SafeText>The builder can write only if you allow that later.</SafeText>
      <SafeText> </SafeText>
      <SelectionList
        items={['Use this folder', 'Back']}
        selected={selected}
        offset={0}
        visibleRows={2}
      />
    </Box>
  );
}

export function HelpOverlay({ colors }: { colors: boolean }) {
  return (
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        Keyboard
      </SafeText>
      <SafeText> </SafeText>
      {KEYMAP.map((line) => (
        <SafeText key={line}>{line}</SafeText>
      ))}
      <SafeText> </SafeText>
      <SafeText dimColor>Press q to close this help.</SafeText>
    </Box>
  );
}

export function AboutOverlay({ colors }: { colors: boolean }) {
  return (
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        BINAFLOW
      </SafeText>
      <SafeText>Local workflows for coding agents.</SafeText>
      <SafeText> </SafeText>
      <SafeText>Binaflow stays attached to the process you started.</SafeText>
      <SafeText>It does not run a daemon or reconnect in the background.</SafeText>
      <SafeText>Credentials belong to the external agent harness.</SafeText>
      <SafeText>Binaflow does not ask for or store provider credentials.</SafeText>
      <SafeText>The planner is read-only.</SafeText>
      <SafeText>Builder write access is shown before a workflow starts.</SafeText>
      <SafeText>Research approval is experimental and explicit.</SafeText>
      <SafeText> </SafeText>
      <SafeText dimColor>Press q to return to the welcome screen.</SafeText>
    </Box>
  );
}
