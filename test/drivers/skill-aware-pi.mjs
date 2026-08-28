/* global process */

import { writeFileSync } from 'node:fs';

writeFileSync(process.env.BINAFLOW_ARGS_FILE, JSON.stringify(process.argv.slice(2)));

let buffer = '';
function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'get_commands') {
      write({
        id: command.id,
        type: 'response',
        success: true,
        data: { commands: [{ name: process.env.BINAFLOW_SKILL_NAME }] },
      });
    } else if (command.type === 'prompt') {
      writeFileSync(process.env.BINAFLOW_PROMPT_FILE, 'prompted');
      write({ id: command.id, type: 'response', success: true });
      write({ type: 'message_end', message: { content: 'done' } });
      write({ type: 'agent_settled' });
    } else {
      write({ id: command.id, type: 'response', success: true, data: {} });
    }
    index = buffer.indexOf('\n');
  }
});
