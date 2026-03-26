/**
 * @file ipcLink.test.ts
 * @module packages/client/tests
 * @project Veritas Security Core
 * * THE INTEGRITY CHECK: This suite verifies that the Veritas 'Nervous System' 
 * is resilient enough to handle hardware-level failures and AI-driven stalls.
 *
 * TEST STRATEGY & SCENARIOS:
 * * 1. TRANSPORT VERIFICATION
 * Confirms that the stdio-based JSON-RPC protocol correctly serializes 
 * and deserializes tRPC operations, even with large forensic data payloads.
 * * 2. ZOMBIE BRAIN SIMULATION (Watchdog Test)
 * Specifically triggers the `__hang__` procedure in the mock engine to verify 
 * that the Watchdog timer correctly identifies a frozen engine and throws 
 * the appropriate Veritas-specific error.
 * * 3. SELF-HEALING & RECOVERY
 * Tests the 'auto-restart' capability. After a watchdog failure or a 
 * process crash, it verifies that the link can transparently respawn 
 * the sentinel-engine and fulfill the next request without user intervention.
 * * 4. LIFECYCLE DISPOSAL
 * Ensures that calling `.close()` gracefully kills the underlying binary 
 * and cleans up all pending listeners, preventing memory leaks and 
 * zombie processes in the host operating system.
 */
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
 * Veritas Security - Test Router
 * Provides the schema for testing standard transport and failure modes.
 */
const t = initTRPC.create();
const appRouter = t.router({
  echo: t.procedure.input(z.any()).query(({ input }) => input as unknown),
  // Used to trigger the Watchdog/Heartbeat timeout
  __hang__: t.procedure.input(z.object({ ms: z.number() })).query(() => undefined),
  __crash__: t.procedure.mutation(() => undefined),
});

type AppRouter = typeof appRouter;

let openClients: TRPCIPCClient[] = [];

/**
 * Helper to create a test client with the Veritas Watchdog enabled.
 */
function makeClient(opts?: { heartbeatTimeoutMs?: number }) {
  const ipcClient = createIPCClient({
    command: process.execPath,
    args: [ECHO_SERVER],
    heartbeatTimeoutMs: opts?.heartbeatTimeoutMs ?? 5000,
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

/**
 * STANDARD TRANSPORT TESTS
 */

test('happy path: echoes input back', async () => {
  const { client } = makeClient();
  const result = await client.echo.query({ payload: 'hello world' });
  expect(result).toEqual({ payload: 'hello world' });
});

test('large payloads: 256KB round trip', async () => {
  const { client } = makeClient();
  const big = 'x'.repeat(256 * 1024);
  const result = await client.echo.query({ big });
  expect(result).toEqual({ big });
});

/**
 * VERITAS RESILIENCE TESTS (WATCHDOG & SELF-HEALING)
 */

test('watchdog: triggers error when the process hangs', async () => {
  // Set a very short timeout for the test
  const { client } = makeClient({ heartbeatTimeoutMs: 500 });

  // Call the hang procedure in the mock
  const hangPromise = client.__hang__.query({ ms: 2000 });

  await expect(hangPromise).rejects.toThrow(/ipcLink: watchdog triggered after 500ms/);
});

test('self-healing: auto-restarts the engine after a watchdog failure', async () => {
  const { client } = makeClient({ heartbeatTimeoutMs: 500 });

  // 1. Force a watchdog failure
  try {
    await client.__hang__.query({ ms: 2000 });
  } catch (e) {
    // Expected failure
  }

  // 2. The very next request should work because the link auto-respawns the process
  const result = await client.echo.query('recovered');
  expect(result).toBe('recovered');
});

test('process crash: next request spawns a fresh process', async () => {
  const { client } = makeClient();

  // Crash the first child process
  await client.__crash__.mutate().catch(() => {
    /* expected */
  });

  // The next request should transparently spawn a new child
  const result = await client.echo.query('recovered from crash');
  expect(result).toBe('recovered from crash');
});

/**
 * LIFECYCLE TESTS
 */

test('close: rejects in-flight requests and blocks new ones', async () => {
  const { client, ipcClient } = makeClient();

  // Start a request that will hang
  const hanging = client.__hang__.query({ ms: 5000 }).catch((e) => e);
  
  await ipcClient.close();
  
  const hangErr = await hanging;
  expect(hangErr).toBeInstanceOf(TRPCClientError);
  expect(hangErr.message).toMatch(/client was closed/);

  // New requests should fail immediately
  const afterErr = await client.echo.query('after').catch((e) => e);
  expect(afterErr.message).toMatch(/client was closed/);
});
