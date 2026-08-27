/* global process */

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const index = buffer.indexOf('\n');
  if (index < 0) return;
  const command = JSON.parse(buffer.slice(0, index));
  if (command.type !== 'prompt') return;
  process.stdout.write(JSON.stringify({ id: command.id, type: 'response', success: true }) + '\n');
  process.stdout.write(
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'first' },
    }) + '\n',
  );
  process.stdout.write(
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'second' },
    }) + '\n',
  );
  process.exit(0);
});
