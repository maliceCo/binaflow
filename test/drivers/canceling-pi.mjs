/* global process, setTimeout */

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
      write({ id: command.id, type: 'response', success: true });
    } else if (command.type === 'abort') {
      setTimeout(() => write({ type: 'agent_settled' }), 100);
    }
    index = buffer.indexOf('\n');
  }
});
