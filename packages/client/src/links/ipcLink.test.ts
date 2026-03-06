import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createTRPCClient } from '../createTRPCClient';
import { TRPCClientError } from '../TRPCClientError';
import { createIPCClient, ipcLink, type TRPCIPCClient } from './ipcLink';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER = path.resolve(__dirname, '../../test/mocks/echo-server.js');

/**
 * Phantom router: provides types only. The actual logic lives in
 * echo-server.js, which echoes `params.input` back as `result.data`.
 */
const t = initTRPC.create();
const appRouter = t.router({
  echo: t.procedure.input(z.any()).query(({ input }) => input as unknown),
  __hang__: t.procedure.query(() => undefined),
  __crash__: t.procedure.mutation(() => undefined),
});
type AppRouter = typeof appRouter;

/**
 * Track every IPC client created during a test so `afterEach` can close
 * them all - zero orphaned child processes, even if a test throws.
 *
 * close() uses the TRPCIPCClient.close() method, which kills the child
 * directly via proc.kill() - no dependency on the server supporting a
 * magic shutdown path.
 */
let openClients: TRPCIPCClient[] = [];

function makeClient() {
  const ipcClient = createIPCClient({
    command: process.execPath,
    args: [ECHO_SERVER],
  });
  openClients.push(ipcClient);

  const client = createTRPCClient<AppRouter>({
    links: [ipcLink({ client: ipcClient })],
  });

  return { client, ipcClient };
}

afterEach(async () => {
  await Promise.all(openClients.map((c) => c.close()));
  openClients = [];
});

test('happy path: echoes input back', async () => {
  const { client } = makeClient();

  const result = await client.echo.query({ payload: 'hello world' });

  expect(result).toEqual({ payload: 'hello world' });
});

test('happy path: multiple sequential requests reuse one process', async () => {
  const { client } = makeClient();

  const a = await client.echo.query('first');
  const b = await client.echo.query('second');
  const c = await client.echo.query('third');

  expect(a).toBe('first');
  expect(b).toBe('second');
  expect(c).toBe('third');
});

test('happy path: concurrent requests are correlated by id', async () => {
  const { client } = makeClient();

  // Fire all at once - responses may arrive in any order, but each must
  // resolve with its own payload.
  const results = await Promise.all([
    client.echo.query('a'),
    client.echo.query('b'),
    client.echo.query('c'),
    client.echo.query('d'),
  ]);

  expect(results).toEqual(['a', 'b', 'c', 'd']);
});

test('large payloads: 256KB round trip', async () => {
  const { client } = makeClient();

  // A 256KB string. This is larger than typical pipe buffer sizes
  // (64KB on most platforms), so stdout will emit multiple `data`
  // chunks that the link must reassemble into one complete line.
  const big = 'x'.repeat(256 * 1024);

  const result = await client.echo.query({ big });

  expect(result).toEqual({ big });
  expect((result as { big: string }).big.length).toBe(256 * 1024);
});

test('large payloads: structured object survives serialization', async () => {
  const { client } = makeClient();

  // Deeply nested + wide structure with a bulky leaf. Exercises JSON
  // parse/stringify correctness across chunk boundaries.
  const payload = {
    items: Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      tags: ['a', 'b', 'c'],
    })),
    blob: 'y'.repeat(64 * 1024),
  };

  const result = await client.echo.query(payload);

  expect(result).toEqual(payload);
});

test('process crash: rejects all pending requests', async () => {
  const { client } = makeClient();

  // Start a request that will never be answered.
  const hanging = client.__hang__.query();

  // Crash the child. This mutation also won't get a response before exit.
  const crashing = client.__crash__.mutate();

  const hangErr = await hanging.catch((e) => e);
  const crashErr = await crashing.catch((e) => e);

  // Both should be rejected with a TRPCClientError wrapping the exit error.
  expect(hangErr).toBeInstanceOf(TRPCClientError);
  expect(hangErr.message).toMatch(/child process exited/);
  expect(hangErr.message).toMatch(/code=1/);

  expect(crashErr).toBeInstanceOf(TRPCClientError);
  expect(crashErr.message).toMatch(/child process exited/);
});

test('process crash: next request spawns a fresh process', async () => {
  const { client } = makeClient();

  // Crash the first child.
  await client.__crash__.mutate().catch(() => {
    // expected
  });

  // The next request should transparently spawn a new child.
  const result = await client.echo.query('recovered');
  expect(result).toBe('recovered');
});

test('process crash: spawn failure rejects with cached error', async () => {
  // Point at a binary that does not exist. The `error` event should
  // fire, cache the spawn error, and every request should reject
  // immediately with that cached error.
  const ipcClient = createIPCClient({
    command: '/definitely/not/a/real/binary',
  });
  openClients.push(ipcClient);

  const client = createTRPCClient<AppRouter>({
    links: [ipcLink({ client: ipcClient })],
  });

  const err1 = await client.echo.query('a').catch((e) => e);
  const err2 = await client.echo.query('b').catch((e) => e);

  expect(err1).toBeInstanceOf(TRPCClientError);
  expect(err2).toBeInstanceOf(TRPCClientError);
});

test('close: rejects in-flight requests and blocks new ones', async () => {
  const { client, ipcClient } = makeClient();

  // Prove the connection works first.
  expect(await client.echo.query('before')).toBe('before');

  // Start a request that won't resolve before close(). Attach .catch()
  // eagerly - the rejection fires DURING `await ipcClient.close()` below,
  // and if there's no handler on the promise yet, vitest flags it as an
  // unhandled rejection.
  const hanging = client.__hang__.query().catch((e) => e);

  await ipcClient.close();

  const hangErr = await hanging;
  expect(hangErr).toBeInstanceOf(TRPCClientError);
  expect((hangErr as TRPCClientError<AppRouter>).message).toMatch(
    /client was closed/,
  );

  // Further requests reject immediately - no new spawn.
  const afterErr = await client.echo.query('after').catch((e: unknown) => e);
  expect(afterErr).toBeInstanceOf(TRPCClientError);
  expect((afterErr as TRPCClientError<AppRouter>).message).toMatch(
    /client was closed/,
  );
});
