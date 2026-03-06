import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import { observable } from '@trpc/server/observable';
import type {
  AnyRouter,
  CombinedDataTransformer,
  inferClientTypes,
  Maybe,
  TRPCResponse,
} from '@trpc/server/unstable-core-do-not-import';
import { transformResult } from '@trpc/server/unstable-core-do-not-import';
import { TRPCClientError } from '../TRPCClientError';
import type { TransformerOptions } from '../unstable-internals';
import { getTransformer } from '../unstable-internals';
import type { Operation, TRPCLink } from './types';

/**
 * Options for {@link createIPCClient}.
 */
export interface IPCClientOptions {
  /**
   * The command to spawn. If `args` is omitted, this can include arguments
   * (parsed by the shell when `spawnOptions.shell` is true) or is treated as
   * the executable path.
   */
  command: string;
  /**
   * Arguments passed to the spawned process.
   */
  args?: readonly string[];
  /**
   * Options forwarded to `child_process.spawn`.
   * `stdio` is always overridden to `['pipe', 'pipe', 'inherit']`.
   */
  spawnOptions?: Omit<SpawnOptions, 'stdio'>;
}

/**
 * Envelope written to the child process's stdin (one per line).
 * Mirrors the shape of `TRPCRequestMessage` from the JSON-RPC spec.
 */
interface IPCRequestEnvelope {
  id: number;
  method: Operation['type'];
  params: {
    path: string;
    input: unknown;
  };
}

/**
 * Envelope read from the child process's stdout (one per line).
 * Must include `id` for request correlation.
 */
type IPCResponseEnvelope = TRPCResponse & { id: number };

interface IPCResult {
  json: TRPCResponse;
  meta: {
    responseJSON: unknown;
  };
}

interface PendingRequest {
  resolve: (value: IPCResult) => void;
  reject: (reason: unknown) => void;
}

/**
 * Polyfill for DOMException with AbortError name
 */
class AbortError extends Error {
  constructor() {
    const name = 'AbortError';
    super(name);
    this.name = name;
    this.message = name;
  }
}

/**
 * Polyfill for `signal.throwIfAborted()`
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted
 */
const throwIfAborted = (signal: Maybe<AbortSignal>) => {
  if (!signal?.aborted) {
    return;
  }
  signal.throwIfAborted?.();
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('AbortError', 'AbortError');
  }
  throw new AbortError();
};

/**
 * A persistent child-process client that speaks newline-delimited JSON over
 * stdin/stdout. The consumer owns the lifecycle: call {@link close} to kill
 * the child and reject any in-flight requests.
 */
export interface TRPCIPCClient {
  /**
   * Send a tRPC operation to the child process. The `transformer` is used to
   * serialize the operation's input before writing to stdin.
   */
  request: (
    op: Operation,
    transformer: CombinedDataTransformer,
  ) => Promise<IPCResult>;

  /**
   * Ends stdin, kills the child process, and rejects all pending requests.
   * After calling this, subsequent `request()` calls will reject immediately.
   */
  close: () => void;
}

/**
 * Creates a persistent child-process client for use with {@link ipcLink}.
 *
 * The process is spawned lazily on the first `request()` call. The consumer
 * must call `close()` to terminate the child and release resources; otherwise
 * the child process will outlive the parent on some platforms.
 *
 * @example
 * ```ts
 * const client = createIPCClient({ command: 'node', args: ['server.js'] });
 * const trpc = createTRPCClient<AppRouter>({
 *   links: [ipcLink({ client })],
 * });
 * // ...
 * client.close();
 * ```
 */
export function createIPCClient(opts: IPCClientOptions): TRPCIPCClient {
  const args = opts.args ?? [];
  const spawnOptions = opts.spawnOptions ?? {};

  let child: ChildProcess | null = null;
  let spawnError: Error | null = null;
  let closed = false;
  let buffer = '';
  const pending = new Map<number, PendingRequest>();

  const rejectAllPending = (cause: unknown) => {
    const error =
      cause instanceof Error
        ? cause
        : new Error('IPC process terminated unexpectedly');
    for (const [, req] of pending) {
      req.reject(error);
    }
    pending.clear();
  };

  const handleStdout = (chunk: Buffer | string) => {
    buffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      let envelope: IPCResponseEnvelope;
      try {
        envelope = JSON.parse(trimmed);
      } catch (cause) {
        // Malformed line — nothing we can safely correlate it to.
        // Surface to any pending requests so callers aren't left hanging.
        rejectAllPending(
          new Error(
            `Failed to parse IPC response: ${(cause as Error).message}`,
          ),
        );
        continue;
      }

      const req = pending.get(envelope.id);
      if (!req) {
        continue;
      }

      pending.delete(envelope.id);
      req.resolve({
        json: envelope,
        meta: {
          responseJSON: envelope,
        },
      });
    }
  };

  const getChild = (): ChildProcess => {
    if (closed) {
      throw new Error('IPC client is closed');
    }
    if (spawnError) {
      throw spawnError;
    }
    if (child) {
      return child;
    }

    const proc = spawn(opts.command, args as string[], {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    proc.once('error', (err) => {
      spawnError = err;
      child = null;
      rejectAllPending(err);
    });

    proc.once('exit', (code, signal) => {
      child = null;
      buffer = '';
      if (pending.size > 0) {
        rejectAllPending(
          new Error(
            `IPC process exited (code=${code ?? 'null'}, signal=${
              signal ?? 'null'
            }) with ${pending.size} pending request(s)`,
          ),
        );
      }
    });

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', handleStdout);

    // Swallow stdin stream errors (e.g. EPIPE when the child dies
    // mid-write). The write callback and the 'exit' handler already
    // reject affected requests; without this listener the error is
    // uncaught and crashes the parent process.
    proc.stdin?.on('error', () => {
      // noop
    });

    child = proc;
    return proc;
  };

  const request = (
    op: Operation,
    transformer: CombinedDataTransformer,
  ): Promise<IPCResult> => {
    return new Promise<IPCResult>((_resolve, _reject) => {
      const { signal } = op;

      try {
        throwIfAborted(signal);
      } catch (cause) {
        _reject(cause);
        return;
      }

      let proc: ChildProcess;
      try {
        proc = getChild();
      } catch (cause) {
        _reject(cause);
        return;
      }

      let settled = false;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (onAbort) {
          signal?.removeEventListener('abort', onAbort);
          onAbort = undefined;
        }
      };

      const resolve = (value: IPCResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        _resolve(value);
      };

      const reject = (reason: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        _reject(reason);
      };

      if (signal) {
        onAbort = () => {
          pending.delete(op.id);
          try {
            throwIfAborted(signal);
          } catch (cause) {
            reject(cause);
          }
        };
        signal.addEventListener('abort', onAbort);
      }

      const serializedInput =
        op.input === undefined
          ? undefined
          : transformer.input.serialize(op.input);

      const envelope: IPCRequestEnvelope = {
        id: op.id,
        method: op.type,
        params: {
          path: op.path,
          input: serializedInput,
        },
      };

      pending.set(op.id, { resolve, reject });

      proc.stdin?.write(JSON.stringify(envelope) + '\n', (err) => {
        if (err) {
          pending.delete(op.id);
          reject(err);
        }
      });
    });
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;

    if (child) {
      child.stdin?.end();
      child.kill();
      child = null;
    }

    buffer = '';
    rejectAllPending(new Error('IPC client is closed'));
  };

  return { request, close };
}

export type IPCLinkOptions<TRouter extends AnyRouter> = {
  client: TRPCIPCClient;
} & TransformerOptions<inferClientTypes<TRouter>>;

/**
 * A terminating link that exchanges tRPC operations with a child process over
 * newline-delimited JSON on stdin/stdout.
 *
 * The consumer creates and owns the process lifecycle via {@link createIPCClient}:
 *
 * ```ts
 * const client = createIPCClient({ command: 'node', args: ['server.js'] });
 * const trpc = createTRPCClient<AppRouter>({
 *   links: [ipcLink({ client })],
 * });
 * // ...
 * client.close();
 * ```
 *
 * Request envelopes written to stdin have the shape:
 *   `{ id, method, params: { path, input } }`
 *
 * Response envelopes read from stdout must echo the `id` and contain a
 * standard tRPC result/error payload.
 */
export function ipcLink<TRouter extends AnyRouter = AnyRouter>(
  opts: IPCLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  const { client } = opts;
  const transformer = getTransformer(opts.transformer);

  return () => {
    return ({ op }) => {
      return observable((observer) => {
        const { type } = op;

        /* istanbul ignore if -- @preserve */
        if (type === 'subscription') {
          throw new Error(
            'Subscriptions are unsupported by `ipcLink` - use `httpSubscriptionLink` or `wsLink`',
          );
        }

        let meta: IPCResult['meta'] | undefined = undefined;

        client
          .request(op, transformer)
          .then((res) => {
            meta = res.meta;

            const transformed = transformResult(
              res.json,
              transformer.output,
            );

            if (!transformed.ok) {
              observer.error(
                TRPCClientError.from(transformed.error, {
                  meta,
                }),
              );
              return;
            }

            observer.next({
              context: res.meta,
              result: transformed.result,
            });
            observer.complete();
          })
          .catch((cause) => {
            observer.error(TRPCClientError.from(cause, { meta }));
          });

        return () => {
          // noop
        };
      });
    };
  };
}
