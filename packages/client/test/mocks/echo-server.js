#!/usr/bin/env node
/**
 * Mock echo server for ipcLink tests.
 *
 * Reads newline-delimited JSON from stdin, writes newline-delimited JSON
 * responses to stdout. Each request has the shape:
 *
 *   { id, method, params: { path, input } }
 *
 * and each response has the shape:
 *
 *   { id, result: { data: <echoed input> } }
 *
 * Special paths:
 *   - `echo`     : echoes `params.input` back as `result.data`
 *   - `__hang__` : never responds (request stays pending forever)
 *   - `__crash__`: terminates the process immediately with exit code 1
 *   - `__close__`: responds then terminates gracefully with exit code 0
 *
 * The server also exits on stdin EOF, so children die when the parent's
 * pipe closes (safety net against orphaned processes).
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

// Exit when the parent closes stdin - prevents orphaned children.
process.stdin.on('end', () => {
  process.exit(0);
});

function respond(id, data) {
  process.stdout.write(JSON.stringify({ id, result: { data } }) + '\n');
}

function handle(msg) {
  const { id, params } = msg;
  const { path, input } = params;

  if (path === '__crash__') {
    // Hard crash - no response, non-zero exit.
    process.exit(1);
  }

  if (path === '__hang__') {
    // Never respond - lets tests create pending requests.
    return;
  }

  if (path === '__close__') {
    // Respond first so the client's promise resolves, then exit gracefully
    // once the write is flushed.
    process.stdout.write(
      JSON.stringify({ id, result: { data: null } }) + '\n',
      () => {
        process.exit(0);
      },
    );
    return;
  }

  // Default: echo the input back.
  respond(id, input);
}
