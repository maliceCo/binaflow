import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const RELEASE_REPOSITORY = 'maliceCo/binaflow';
export const INSTALL_ROOT_ENV = 'BINAFLOW_INSTALL_ROOT';

export interface InstallPaths {
  root: string;
  versions: string;
  current: string;
  previous: string;
  lock: string;
}

export function defaultInstallRoot(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'binaflow');
}

export function installPaths(
  root = process.env[INSTALL_ROOT_ENV] ?? defaultInstallRoot(),
): InstallPaths {
  const absoluteRoot = resolve(root);
  return {
    root: absoluteRoot,
    versions: join(absoluteRoot, 'versions'),
    current: join(absoluteRoot, 'current'),
    previous: join(absoluteRoot, 'previous'),
    lock: join(absoluteRoot, '.update.lock'),
  };
}

export function managedInstallRoot(): string {
  const root = process.env[INSTALL_ROOT_ENV];
  if (!root) {
    throw new Error(
      'Self-update is available only from a Binaflow bundle installed by install.sh. Use the GitHub Release installer first.',
    );
  }
  return resolve(root);
}
