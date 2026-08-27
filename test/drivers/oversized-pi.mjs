/* global process */

const size = Number(process.env.BINAFLOW_RESULT_SIZE);
const kind = process.env.BINAFLOW_RESULT_KIND;
let buffer = '';

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const index = buffer.indexOf('\n');
  if (index < 0) return;
  const command = JSON.parse(buffer.slice(0, index));
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
});
