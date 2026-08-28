/* global process */

const size = Number(process.env.BINAFLOW_RESULT_SIZE);
const kind = process.env.BINAFLOW_RESULT_KIND;
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
      write({ id: command.id, type: 'response', success: true, data: { commands: [] } });
    } else {
      write({ id: command.id, type: 'response', success: true });
      if (kind === 'delta') {
        write({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(size) },
        });
      } else {
        write({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(size) }] },
        });
      }
    }
    index = buffer.indexOf('\n');
  }
});
