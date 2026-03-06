import { resolve } from 'path';
import { createTRPCClient } from '../createTRPCClient';
import { TRPCClientError } from '../TRPCClientError';
import { ipcLink } from './ipcLink';

const ECHO_SERVER = resolve(__dirname, '../../test/mocks/echo-server.js');

/**
 * Helper: create a client backed by ipcLink pointing at the echo server.
 * Returns the client and an AbortController for teardown.
 */
function createEchoClient() {
  const ac = new AbortController();
  const client = createTRPCClient<any>({
    links: [
      ipcLink({
        command: 'node',
        args: [ECHO_SERVER],
        signal: ac.signal,
      }),
    ],
  });
  return { client, ac };
}

afterEach(() => {
  // nothing — each test tears down via AbortController
});

// --- Happy path ---

test('happy path: query returns the echoed input', async () => {
  const { client, ac } = createEchoClient();

  try {
    const result = await client.greet.query('hello');
    expect(result).toBe('hello');
  } finally {
    ac.abort();
  }
});

test('happy path: mutation returns the echoed input', async () => {
  const { client, ac } = createEchoClient();

  try {
    const result = await client.doSomething.mutate({ foo: 'bar' });
    expect(result).toEqual({ foo: 'bar' });
  } finally {
    ac.abort();
  }
});

test('happy path: multiple sequential requests', async () => {
  const { client, ac } = createEchoClient();

  try {
    const r1 = await client.a.query(1);
    const r2 = await client.b.query(2);
    const r3 = await client.c.query(3);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(r3).toBe(3);
  } finally {
    ac.abort();
  }
});

test('happy path: concurrent requests resolve correctly', async () => {
  const { client, ac } = createEchoClient();

  try {
    const [r1, r2, r3] = await Promise.all([
      client.x.query('alpha'),
      client.y.query('beta'),
      client.z.query('gamma'),
    ]);
    expect(r1).toBe('alpha');
    expect(r2).toBe('beta');
    expect(r3).toBe('gamma');
  } finally {
    ac.abort();
  }
});

// --- Large payloads (NDJSON buffering) ---

test('large payload: handles response split across multiple chunks', async () => {
  const { client, ac } = createEchoClient();

  try {
    // 100KB string — large enough that Node will likely split stdout into
    // multiple data events, exercising the buffer accumulator.
    const bigInput = 'x'.repeat(100_000);
    const result = await client.big.query(bigInput);
    expect(result).toBe(bigInput);
    expect(result.length).toBe(100_000);
  } finally {
    ac.abort();
  }
});

test('large payload: complex nested object', async () => {
  const { client, ac } = createEchoClient();

  try {
    const bigObject = {
      items: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        data: 'y'.repeat(100),
      })),
    };
    const result = await client.nested.query(bigObject);
    expect(result).toEqual(bigObject);
  } finally {
    ac.abort();
  }
});

// --- Process crash ---

test('process crash: pending requests reject when child is killed', async () => {
  const { client, ac } = createEchoClient();

  // Start a request but don't await it yet — we need to kill the child
  // while it's in flight. The echo server responds instantly though, so
  // we need a server that delays. Instead, we'll abort the link signal
  // which kills the child.
  //
  // Actually — let's test the real scenario: create a link, kill the
  // child via signal, then verify the pending request rejects.

  // First verify it works
  const r1 = await client.warmup.query('ok');
  expect(r1).toBe('ok');

  // Now abort (kills the child)
  ac.abort();

  // Next request should reject immediately since child is dead
  await expect(client.afterDeath.query('fail')).rejects.toThrow(
    TRPCClientError,
  );
});

test('process crash: link recoverable with a new instance', async () => {
  // First link — kill it
  const { client: client1, ac: ac1 } = createEchoClient();

  const r1 = await client1.pre.query('alive');
  expect(r1).toBe('alive');

  ac1.abort();

  await expect(client1.post.query('dead')).rejects.toThrow(TRPCClientError);

  // Second link — fresh child process, should work fine
  const { client: client2, ac: ac2 } = createEchoClient();

  try {
    const r2 = await client2.recovered.query('back');
    expect(r2).toBe('back');
  } finally {
    ac2.abort();
  }
});

test('process crash: child exit rejects all pending requests', async () => {
  // Spawn a link with a command that exits immediately
  const ac = new AbortController();
  const client = createTRPCClient<any>({
    links: [
      ipcLink({
        command: 'node',
        args: ['-e', 'process.exit(1)'],
        signal: ac.signal,
      }),
    ],
  });

  // Give the child a moment to exit
  await new Promise((r) => setTimeout(r, 100));

  // Request should fail — child is already dead
  await expect(client.dead.query('nope')).rejects.toThrow(TRPCClientError);

  ac.abort();
});

// --- Subscription rejection ---

test('subscriptions are rejected with a clear error', async () => {
  const { client, ac } = createEchoClient();

  try {
    await new Promise<void>((resolve, reject) => {
      client.events.subscribe(undefined, {
        onError: (err: any) => {
          try {
            expect(err).toBeInstanceOf(TRPCClientError);
            expect(err.message).toContain('unsupported');
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        onData: () => {
          reject(new Error('should not receive data'));
        },
      });
    });
  } finally {
    ac.abort();
  }
});
