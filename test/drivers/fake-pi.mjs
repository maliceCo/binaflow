/* global process */

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
    if (command.type === 'prompt') {
      write({ id: command.id, type: 'response', command: 'prompt', success: true });
      write({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      });
      write({ type: 'message_end', message: { content: [{ type: 'text', text: 'hello' }] } });
      write({ type: 'agent_settled' });
    } else if (command.type === 'get_state') {
      write({
        id: command.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: { sessionId: 'session-1' },
      });
    } else if (command.type === 'get_session_stats') {
      write({
        id: command.id,
        type: 'response',
        command: 'get_session_stats',
        success: true,
        data: { tokens: { input: 10, output: 5, total: 15 }, cost: 0.25 },
      });
    } else {
      write({ id: command.id, type: 'response', command: command.type, success: true });
    }
    index = buffer.indexOf('\n');
  }
});
