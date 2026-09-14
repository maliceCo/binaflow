import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';

export async function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exit.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  force: boolean,
): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], () =>
        resolve(),
      );
    });
    return;
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}
