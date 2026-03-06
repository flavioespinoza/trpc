/**
 * Echo server for ipcLink tests.
 *
 * Reads newline-delimited JSON from stdin, echoes back a valid tRPC
 * response envelope with the same id and the input as the result data.
 *
 * Protocol:
 *   IN:  {"id":1,"method":"query","params":{"path":"hello","input":"world"}}
 *   OUT: {"id":1,"result":{"type":"data","data":"world"}}
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

    const response = {
      id: request.id,
      result: {
        type: 'data',
        data: request.params.input,
      },
    };

    process.stdout.write(JSON.stringify(response) + '\n');
  }
});
