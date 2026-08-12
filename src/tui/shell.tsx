import type { ReactNode } from 'react';
import {
  runInkApplication,
  type InkApplicationContext,
  type InkApplicationOptions,
} from './bootstrap.js';
import { InkShellController } from './shell-controller.js';
import { createAttachedExecutionLifecycle, type AttachedExecutionLifecycle } from './lifecycle.js';
import type { ApplicationService } from '../application/service.js';

export interface InkShellOptions extends InkApplicationOptions {
  cwd?: string;
  configPath?: string;
  applicationContext?: (ApplicationService & { close?(): void }) | undefined;
  openApplicationContext?:
    | ((configPath: string, cwd: string) => Promise<ApplicationService & { close?(): void }>)
    | undefined;
  forceExit?: (signal: NodeJS.Signals) => void;
}

interface InkShellProps extends InkApplicationContext {
  cwd: string;
  configPath: string;
  lifecycle: AttachedExecutionLifecycle<ApplicationService & { close?(): void }>;
  openApplicationContext?: InkShellOptions['openApplicationContext'] | undefined;
  registerSignalHandler: (handler: (signal: NodeJS.Signals) => boolean) => () => void;
  hasInjectedContext?: boolean;
}

export async function runInkShell(options: InkShellOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? '.binaflow/config.json';
  const lifecycle = createAttachedExecutionLifecycle(options.applicationContext);
  let signalHandler: ((signal: NodeJS.Signals) => boolean) | undefined;
  try {
    await runInkApplication(
      { ...options, onSignal: (signal) => signalHandler?.(signal) ?? false },
      (context) => (
        <InkShell
          cwd={cwd}
          configPath={configPath}
          lifecycle={lifecycle}
          openApplicationContext={options.openApplicationContext}
          registerSignalHandler={(handler) => {
            signalHandler = handler;
            return () => {
              if (signalHandler === handler) signalHandler = undefined;
            };
          }}
          hasInjectedContext={
            options.applicationContext !== undefined || options.openApplicationContext !== undefined
          }
          {...context}
        />
      ),
    );
  } finally {
    if (!lifecycle.forceSignal) await lifecycle.shutdown();
  }
  const signal = lifecycle.forceSignal;
  if (signal) {
    (options.forceExit ?? ((value) => process.kill(process.pid, value)))(signal);
    await lifecycle.shutdown();
  }
}

/** Keeps the public shell as the attached-screen router and prop boundary. */
function InkShell(props: InkShellProps): ReactNode {
  return <InkShellController {...props} />;
}
