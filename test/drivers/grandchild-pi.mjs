/* global process */

const { spawn } = await import('node:child_process');
const { writeFileSync } = await import('node:fs');

const sentinel = process.env.BINAFLOW_SENTINEL;
const child = spawn(
  process.execPath,
  [
    '-e',
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'created'), 1500)`,
  ],
  { stdio: 'ignore' },
);
void child;
process.stdin.resume();
writeFileSync(process.env.BINAFLOW_PARENT_READY, JSON.stringify({ childPid: child.pid }));
