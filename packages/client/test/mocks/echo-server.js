/**
 * Mock echo server for ipcLink tests.
 *
 * Reads newline-delimited JSON from stdin, writes newline-delimited JSON
 * responses to stdout.
 *
 * Special paths:
 *   - `echo`      : echoes `params.input` back as `result.data`
 *   - `__hang__`  : never responds (lets watchdog fire)
 *   - `__crash__` : terminates immediately with exit code 1
 */

process.stdin.setEncoding('utf8');

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.length > 0) {
      handle(JSON.parse(line));
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

function handle(req) {
  const { id, params } = req;

  if (params.path === '__crash__') {
    process.exit(1);
  }

  if (params.path === '__hang__') {
    // Never respond — lets the watchdog timer fire.
    return;
  }

  // Default: echo input back.
  const response = {
    id,
    result: {
      type: 'data',
      data: params.input,
    },
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}
