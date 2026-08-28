/* global process */

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === 'get_commands') {
      process.stdout.write(
        JSON.stringify({
          id: command.id,
          type: 'response',
          success: true,
          data: { commands: [] },
        }) + '\n',
      );
    } else if (command.type === 'prompt') {
      process.stdout.write(
        JSON.stringify({ id: command.id, type: 'response', success: true }) + '\n',
      );
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
    }
    index = buffer.indexOf('\n');
  }
});
