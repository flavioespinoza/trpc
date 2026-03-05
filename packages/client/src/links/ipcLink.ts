import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import { observable } from '@trpc/server/observable';
import type {
  AnyClientTypes,
  AnyRouter,
  CombinedDataTransformer,
  Maybe,
  TRPCResponse,
} from '@trpc/server/unstable-core-do-not-import';
import { transformResult } from '@trpc/server/unstable-core-do-not-import';
import { TRPCClientError } from '../TRPCClientError';
import type { TransformerOptions } from '../unstable-internals';
import { getTransformer } from '../unstable-internals';
import type { Operation, TRPCLink } from './types';

/**
 * @internal
 */
export type IPCLinkBaseOptions<
  TRoot extends Pick<AnyClientTypes, 'transformer'>,
> = {
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
} & TransformerOptions<TRoot>;

export type IPCLinkOptions<TRouter extends AnyRouter> = IPCLinkBaseOptions<
  TRouter['_def']['_config']['$types']
>;

interface ResolvedIPCLinkOptions {
  command: string;
  args: readonly string[];
  spawnOptions: Omit<SpawnOptions, 'stdio'>;
  transformer: CombinedDataTransformer;
}

function resolveIPCLinkOptions(
  opts: IPCLinkBaseOptions<AnyClientTypes>,
): ResolvedIPCLinkOptions {
  return {
    command: opts.command,
    args: opts.args ?? [],
    spawnOptions: opts.spawnOptions ?? {},
    transformer: getTransformer(opts.transformer),
  };
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

interface IPCClient {
  request: (op: Operation) => Promise<IPCResult>;
}

function createIPCClient(opts: ResolvedIPCLinkOptions): IPCClient {
  let child: ChildProcess | null = null;
  let spawnError: Error | null = null;
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
    if (spawnError) {
      throw spawnError;
    }
    if (child) {
      return child;
    }

    const proc = spawn(opts.command, opts.args as string[], {
      ...opts.spawnOptions,
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

    child = proc;
    return proc;
  };

  const request = (op: Operation): Promise<IPCResult> => {
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
          : opts.transformer.input.serialize(op.input);

      const envelope: IPCRequestEnvelope = {
        id: op.id,
        method: op.type,
        params: {
          path: op.path,
          input: serializedInput,
        },
      };

      pending.set(op.id, { resolve, reject });

      const ok = proc.stdin?.write(JSON.stringify(envelope) + '\n', (err) => {
        if (err) {
          pending.delete(op.id);
          reject(err);
        }
      });

      if (ok === false) {
        // stdin is not available (e.g. process already died)
        pending.delete(op.id);
        reject(new Error('IPC process stdin is not writable'));
      }
    });
  };

  return { request };
}

/**
 * A terminating link that spawns a persistent child process and exchanges
 * tRPC operations with it over newline-delimited JSON on stdin/stdout.
 *
 * Request envelopes written to stdin have the shape:
 *   { id, method, params: { path, input } }
 *
 * Response envelopes read from stdout must echo the `id` and contain a
 * standard tRPC result/error payload.
 */
export function ipcLink<TRouter extends AnyRouter = AnyRouter>(
  opts: IPCLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  const resolvedOpts = resolveIPCLinkOptions(opts);
  const client = createIPCClient(resolvedOpts);

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
          .request(op)
          .then((res) => {
            meta = res.meta;
            const transformed = transformResult(
              res.json,
              resolvedOpts.transformer.output,
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
