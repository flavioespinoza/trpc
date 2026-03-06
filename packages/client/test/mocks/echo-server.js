/**
 * Echo server for ipcLink tests.
 *
 * Reads newline-delimited JSON from stdin, echoes back a valid tRPC
 * response envelope with the same id and the input as the result data.
 *
 * Special paths:
 *   __generate — input must be a number N; responds with a string of N 'x' chars.
 *                Tests NDJSON stdout buffering with large responses from small requests.
 *
 * Wire protocol:
 *   IN:  {"id":1,"method":"query","params":{"path":"echo","input":"hello"}}
 *   OUT: {"id":1,"result":{"type":"data","data":"hello"}}
 */

let buffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  buffer += chunk;

  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    if (line.length === 0) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }

    let data = request.params.input;

    if (request.params.path === '__generate') {
      data = 'x'.repeat(Number(data));
    }

    const response = {
      id: request.id,
      result: {
        type: 'data',
        data,
      },
    };

    process.stdout.write(JSON.stringify(response) + '\n');
  }
});
