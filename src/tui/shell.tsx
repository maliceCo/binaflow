import type { ReactNode } from 'react';
import {
  runInkApplication,
  type InkApplicationContext,
  type InkApplicationOptions,
} from './bootstrap.js';
import { InkShellController } from './shell-controller.js';
import { createAttachedExecutionLifecycle, type AttachedExecutionLifecycle } from './lifecycle.js';
import type { ApplicationContext } from '../application/runtime.js';
import type { ApplicationService } from '../application/service.js';

export type ApplicationContextInput =
  ApplicationContext | (ApplicationService & { close?(): void });

export interface InkShellOptions extends InkApplicationOptions {
  cwd?: string;
  configPath?: string;
  applicationContext?: ApplicationContextInput | undefined;
  openApplicationContext?:
    ((configPath: string, cwd: string) => Promise<ApplicationContextInput>) | undefined;
  forceExit?: (signal: NodeJS.Signals) => void;
}

interface InkShellProps extends InkApplicationContext {
  cwd: string;
  configPath: string;
  lifecycle: AttachedExecutionLifecycle<ApplicationContext>;
  openApplicationContext?: InkShellOptions['openApplicationContext'] | undefined;
  registerSignalHandler: (handler: (signal: NodeJS.Signals) => boolean) => () => void;
  hasInjectedContext?: boolean;
}

export async function runInkShell(options: InkShellOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? '.binaflow/config.json';
  const lifecycle = createAttachedExecutionLifecycle(
    options.applicationContext ? asApplicationContext(options.applicationContext) : undefined,
  );
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
    await lifecycle.shutdown();
    (options.forceExit ?? ((value) => process.kill(process.pid, value)))(signal);
  }
}

export function asApplicationContext(input: ApplicationContextInput): ApplicationContext {
  if ('application' in input) return input;
  return {
    application: input,
    close: () => input.close?.(),
  };
}

/** Keeps the public shell as the attached-screen router and prop boundary. */
function InkShell(props: InkShellProps): ReactNode {
  return <InkShellController {...props} />;
}
