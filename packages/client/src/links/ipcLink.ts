
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
  /**
   * Watchdog: Maximum time (ms) to wait for a response before 
   * considering the process frozen and restarting it.
   * Defaults to 5000ms.
   */
  heartbeatTimeoutMs?: number;
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
  startedAt: number;
}

class AbortError extends Error {
  constructor() {
    const name = 'AbortError';
    super(name);
    this.name = name;
    this.message = name;
  }
}

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

class TRPCIPCClosedError extends Error {
  constructor() {
    super('ipcLink: client was closed');
    this.name = 'TRPCIPCClosedError';
  }
}

class TRPCIPCWatchdogError extends Error {
  constructor(timeout: number) {
    super(`ipcLink: watchdog triggered after ${timeout}ms of silence`);
    this.name = 'TRPCIPCWatchdogError';
  }
}

class IpcClient {
  private child: ChildProcess | null = null;
  private spawnError: Error | null = null;
  private closed = false;
  private buffer = '';
  private pending = new Map<number, PendingRequest>();
  private opts: IPCClientOptions;
  private lastActivityAt = 0;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(opts: IPCClientOptions) {
    this.opts = opts;
  }

  private rejectAll(cause: unknown) {
    const reqs = [...this.pending.values()];
    for (const req of reqs) {
      req.reject(cause);
    }
    this.pending.clear();
  }

  private handleLine(line: string) {
    this.lastActivityAt = Date.now();
    let msg: IPCResponseMessage;
    try {
      msg = JSON.parse(line);
    } catch (cause) {
      this.rejectAll(
        new Error(`ipcLink: failed to parse response JSON: ${String(cause)}`),
      );
      return;
    }

    const req = this.pending.get(msg.id);
    if (!req) {
      return;
    }
    req.resolve({
      json: msg,
      meta: {
        responseJSON: msg,
      },
    });
  }

  private startWatchdog() {
    if (this.watchdogTimer) return;
    const timeout = this.opts.heartbeatTimeoutMs ?? 5000;
    
    this.watchdogTimer = setInterval(() => {
      if (this.pending.size === 0 || !this.child) return;

      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityAt;

      if (timeSinceActivity > timeout) {
        const error = new TRPCIPCWatchdogError(timeout);
        this.restart(error);
      }
    }, 1000);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private restart(cause: Error) {
    const proc = this.child;
    this.child = null;
    this.rejectAll(cause);
    if (proc) {
      proc.kill('SIGKILL');
    }
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
    this.lastActivityAt = Date.now();
    this.startWatchdog();

    proc.once('error', (err) => {
      this.spawnError = err;
      this.child = null;
      this.stopWatchdog();
      this.rejectAll(err);
    });

    proc.once('exit', (code, signal) => {
      this.child = null;
      this.buffer = '';
      this.stopWatchdog();
      this.rejectAll(
        new Error(
          `ipcLink: child process exited (code=${code}, signal=${signal})`,
        ),
      );
    });

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
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
        startedAt: Date.now(),
      });

      if (op.signal) {
        onAbort = () => {
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

      return () => {};
    });
  }

  public close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.closed = true;
    this.stopWatchdog();
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
