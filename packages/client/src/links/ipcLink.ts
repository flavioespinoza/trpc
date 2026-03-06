import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
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
import type {
  Operation,
  OperationResultEnvelope,
  TRPCLink,
} from './types';

export interface IPCClientOptions {
  /**
   * The command to spawn.
   */
  command: string;
  /**
   * Arguments to pass to the spawned command.
   */
  args?: string[];
  /**
   * Options to pass to `child_process.spawn`.
   * `stdio` is always forced to `['pipe', 'pipe', 'inherit']`.
   */
  spawnOptions?: Omit<SpawnOptions, 'stdio'>;
}

interface IPCRequestMessage {
  id: number;
  method: Operation['type'];
  params: {
    path: string;
    input: unknown;
  };
}

type IPCResponseMessage = TRPCResponse & { id: number };

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
  // If available, use the native implementation
  signal.throwIfAborted?.();

  // If we have `DOMException`, use it
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('AbortError', 'AbortError');
  }

  // Otherwise, use our own implementation
  throw new AbortError();
};

class TRPCIPCClosedError extends Error {
  constructor() {
    super('ipcLink: client was closed');
    this.name = 'TRPCIPCClosedError';
  }
}

/**
 * Manages a persistent child process and correlates tRPC operations to
 * newline-delimited JSON responses over stdio.
 *
 * The process is spawned lazily on the first request. If it crashes, the
 * next request will spawn a fresh one. Call `close()` to kill the child
 * and reject any in-flight requests.
 */
class IpcClient {
  private child: ChildProcess | null = null;
  private spawnError: Error | null = null;
  private closed = false;
  private buffer = '';
  private pending = new Map<number, PendingRequest>();
  private opts: IPCClientOptions;

  constructor(opts: IPCClientOptions) {
    this.opts = opts;
  }

  private rejectAll(cause: unknown) {
    // Snapshot before iterating - req.reject() calls cleanup() which
    // mutates the map.
    const reqs = [...this.pending.values()];
    for (const req of reqs) {
      req.reject(cause);
    }
  }

  private handleLine(line: string) {
    let msg: IPCResponseMessage;
    try {
      msg = JSON.parse(line);
    } catch (cause) {
      // Malformed JSON from child - reject everything in flight since we
      // can no longer correlate responses.
      this.rejectAll(
        new Error(`ipcLink: failed to parse response JSON: ${String(cause)}`),
      );
      return;
    }

    const req = this.pending.get(msg.id);
    if (!req) {
      // Response for unknown id - ignore.
      return;
    }
    req.resolve({
      json: msg,
      meta: {
        responseJSON: msg,
      },
    });
  }

  private start() {
    if (this.child || this.spawnError || this.closed) {
      return;
    }

    const proc = spawn(this.opts.command, this.opts.args ?? [], {
      ...this.opts.spawnOptions,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.child = proc;

    proc.once('error', (err) => {
      this.spawnError = err;
      this.child = null;
      this.rejectAll(err);
    });

    proc.once('exit', (code, signal) => {
      // Clear `child` but NOT `spawnError` - a crash after successful spawn
      // is transient. The next request will spawn a fresh process. If the
      // process fails to spawn at all, the `error` handler above caches that
      // permanently.
      this.child = null;
      this.buffer = '';
      this.rejectAll(
        new Error(
          `ipcLink: child process exited (code=${code}, signal=${signal})`,
        ),
      );
    });

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;

      // Only emit complete messages - newline-terminated lines.
      let newlineIndex: number;
      while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          this.handleLine(line);
        }
      }
    });
  }

  private ipcRequest(
    op: Operation,
    transformer: CombinedDataTransformer,
  ): Promise<IPCResult> {
    return new Promise((resolve, reject) => {
      throwIfAborted(op.signal);

      if (this.closed) {
        reject(new TRPCIPCClosedError());
        return;
      }

      this.start();

      if (this.spawnError) {
        reject(this.spawnError);
        return;
      }

      /* istanbul ignore if -- @preserve */
      if (!this.child?.stdin) {
        reject(new Error('ipcLink: child process stdin is not available'));
        return;
      }

      const input = transformer.input.serialize(op.input);
      const message: IPCRequestMessage = {
        id: op.id,
        method: op.type,
        params: {
          path: op.path,
          input,
        },
      };

      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        this.pending.delete(op.id);
        if (onAbort) {
          op.signal?.removeEventListener('abort', onAbort);
        }
      };

      this.pending.set(op.id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (cause) => {
          cleanup();
          reject(cause);
        },
      });

      if (op.signal) {
        onAbort = () => {
          // We can't un-send bytes already written to stdin; the child may
          // still reply, but by then pending.get(id) is undefined and the
          // response is dropped.
          cleanup();
          try {
            throwIfAborted(op.signal);
          } catch (cause) {
            reject(cause);
          }
        };
        op.signal.addEventListener('abort', onAbort);
      }

      try {
        this.child.stdin.write(JSON.stringify(message) + '\n');
      } catch (cause) {
        cleanup();
        reject(cause);
      }
    });
  }

  /**
   * Issues a single tRPC operation to the child process and returns an
   * observable that emits exactly one result (or errors).
   *
   * The transformer is passed in per-request (not stored on the client)
   * so that `ipcLink` remains the single place that resolves transformer
   * options - mirrors `WsClient.request()`.
   */
  public request({
    op,
    transformer,
  }: {
    op: Operation;
    transformer: CombinedDataTransformer;
  }) {
    return observable<
      OperationResultEnvelope<unknown, TRPCClientError<AnyRouter>>,
      TRPCClientError<AnyRouter>
    >((observer) => {
      const { type } = op;
      /* istanbul ignore if -- @preserve */
      if (type === 'subscription') {
        throw new Error(
          'Subscriptions are unsupported by `ipcLink` - use `httpSubscriptionLink` or `wsLink`',
        );
      }

      let meta: IPCResult['meta'] | undefined = undefined;
      this.ipcRequest(op, transformer)
        .then((res) => {
          meta = res.meta;
          const transformed = transformResult(res.json, transformer.output);

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
  }

  /**
   * Closes the IPC client: rejects all in-flight requests, kills the
   * child process, and prevents any further requests.
   *
   * The returned promise resolves once the child has actually exited
   * (or immediately if no child was ever spawned).
   */
  public close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.closed = true;

    this.rejectAll(new TRPCIPCClosedError());

    const proc = this.child;
    if (!proc) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill();
    });
  }
}

export function createIPCClient(opts: IPCClientOptions) {
  return new IpcClient(opts);
}

export type TRPCIPCClient = ReturnType<typeof createIPCClient>;

export type IPCLinkOptions<TRouter extends AnyRouter> = {
  client: TRPCIPCClient;
} & TransformerOptions<inferClientTypes<TRouter>>;

/**
 * A terminating link that talks to a child process over stdio using
 * newline-delimited JSON. The child process lifecycle is managed by a
 * separate `TRPCIPCClient` (created via `createIPCClient`), which
 * exposes `.close()` for graceful shutdown.
 *
 * @see https://trpc.io/docs/client/links/ipcLink
 */
export function ipcLink<TRouter extends AnyRouter = AnyRouter>(
  opts: IPCLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  const { client } = opts;
  const transformer = getTransformer(opts.transformer);
  return () => {
    return ({ op }) => {
      return observable((observer) => {
        const requestSubscription = client
          .request({
            op,
            transformer,
          })
          .subscribe(observer);

        return () => {
          requestSubscription.unsubscribe();
        };
      });
    };
  };
}
