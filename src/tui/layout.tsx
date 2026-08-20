import { Box } from 'ink';
import type { ReactNode } from 'react';
import type { ConfigurationDiagnosis } from '../application/config-operations.js';
import { humanRunStatus, truncateDisplay } from '../presentation/format.js';
import { SafeText, SelectionList } from './components.js';
import type { LiveState } from './execution.js';
import type { FolderEntry, TuiState } from './model.js';
import { workflowItems } from './screens/workflows.js';

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
  const paneRows = Math.max(1, size.rows - 9);
  const workflowsRows = Math.max(1, Math.floor(paneRows / 2));
  const runsRows = Math.max(1, paneRows - workflowsRows);
  const footer =
    state.detail === 'live'
      ? 'q cancel   Ctrl-C cancel   d activity   j/k scroll'
      : 'n new run   w folder   d status   ? help   Tab switch   q quit';
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <SafeText bold>{'Binaflow  '}</SafeText>
          <SafeText {...(colors ? { color: ready ? 'green' : 'yellow' } : {})}>
            {ready ? 'Ready' : 'Needs attention'}
          </SafeText>
        </Box>
        <SafeText dimColor>{truncateDisplay(state.cwd, Math.max(20, size.columns - 40))}</SafeText>
      </Box>
      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" width={Math.max(24, Math.floor(size.columns * 0.4))}>
          <SafeText bold>Workflows</SafeText>
          {workflowLabels.length > 0 ? (
            <SelectionList
              items={workflowLabels}
              selected={state.workflowSelected}
              offset={0}
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
              offset={0}
              visibleRows={runsRows}
            />
          ) : (
            <SafeText> No runs yet.</SafeText>
          )}
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          width={`${Math.max(10, size.columns - Math.max(24, Math.floor(size.columns * 0.4)))}`}
        >
          {right}
        </Box>
      </Box>
      <Box flexDirection="column">
        {state.error ? <SafeText color="red">{state.error}</SafeText> : null}
        {state.status ? <SafeText color="cyan">{state.status}</SafeText> : null}
        {live && liveDetail ? <SafeText dimColor>Activity detail</SafeText> : null}
        <SafeText dimColor>{footer}</SafeText>
      </Box>
    </Box>
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
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        BINAFLOW
      </SafeText>
      <SafeText>Local workflows for coding agents.</SafeText>
      <SafeText> </SafeText>
      <SafeText dimColor>{cwd}</SafeText>
      <SafeText>{status}</SafeText>
      <SafeText> </SafeText>
      <SelectionList items={WELCOME_ACTIONS} selected={selected} offset={0} visibleRows={4} />
    </Box>
  );
}

export function FolderPickerScreen({
  colors,
  entries,
  selected,
  offset,
  path,
  visibleRows,
}: {
  colors: boolean;
  entries: FolderEntry[];
  selected: number;
  offset: number;
  path: string;
  visibleRows: number;
}) {
  const items = entries.map((entry) => {
    if (entry.error) return `${entry.isParent ? '..' : entry.name} (${entry.error})`;
    return entry.isParent ? '..' : `${entry.name}${entry.hasBinaflow ? ' [Binaflow]' : ''}`;
  });
  const list = [...items, 'Use this folder'];
  return (
    <Box flexDirection="column" padding={1}>
      <SafeText bold {...(colors ? { color: 'cyan' } : {})}>
        Choose a folder
      </SafeText>
      <SafeText dimColor>{path}</SafeText>
      <SafeText>Enter opens a folder, Space uses the selected folder.</SafeText>
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
      <SafeText>Binaflow is a local workflow orchestrator. Workflows define the</SafeText>
      <SafeText>work; external agent harnesses execute individual steps.</SafeText>
      <SafeText> </SafeText>
      <SafeText dimColor>Press q to close this note.</SafeText>
    </Box>
  );
}
