/* global process */

import { runInkFoundation } from '../dist/src/tui-ink/bootstrap.js';

try {
  await runInkFoundation();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
