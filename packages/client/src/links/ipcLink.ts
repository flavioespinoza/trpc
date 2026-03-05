import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { observable } from '@trpc/server/observable';
import type {
  AnyRouter,
  inferClientTypes,
  TRPCResponse,
} from '@trpc/server/unstable-core-do-not-import';
import { transformResult } from '@trpc/server/unstable-core-do-not-import';
import { TRPCClientError } from '../TRPCClientError';
import type { TransformerOptions } from '../unstable-internals';
import { getTransformer } from '../unstable-internals';
import type { Operation, TRPCLink } from './types';

export type IPCLinkOptions<TRouter extends AnyRouter> = {
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
} & TransformerOptions<inferClientTypes<TRouter>>;

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
 * A terminating link that spawns a persistent child process and communicates
 * tRPC operations over stdio using newline-delimited JSON.
 *
 * Each operation is written to the child's stdin as a single JSON line, and
 * responses are read from stdout as newline-delimited JSON. Responses are
 * correlated to requests by `id`.
 *
 * @see https://trpc.io/docs/client/links/ipcLink
 */
export function ipcLink<TRouter extends AnyRouter = AnyRouter>(
  opts: IPCLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  const transformer = getTransformer(opts.transformer);

  let child: ChildProcess | null = null;
  let spawnError: Error | null = null;
  let buffer = '';

  const pending = new Map<number, PendingRequest>();

  const rejectAll = (cause: unknown) => {
    for (const [, req] of pending) {
      req.reject(cause);
    }
    pending.clear();
  };

  const handleLine = (line: string) => {
    let msg: IPCResponseMessage;
    try {
      msg = JSON.parse(line);
    } catch (cause) {
      // Malformed JSON from child - reject everything in flight since we
      // can no longer correlate responses.
      rejectAll(
        new Error(`ipcLink: failed to parse response JSON: ${String(cause)}`),
      );
      return;
    }

    const req = pending.get(msg.id);
    if (!req) {
      // Response for unknown id - ignore.
      return;
    }
    pending.delete(msg.id);
    req.resolve({
      json: msg,
      meta: {
        responseJSON: msg,
      },
    });
  };

  const start = () => {
    if (child || spawnError) {
      return;
    }

    const proc = spawn(opts.command, opts.args ?? [], {
      ...opts.spawnOptions,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    child = proc;

    proc.once('error', (err) => {
      spawnError = err;
      child = null;
      rejectAll(err);
    });

    proc.once('exit', (code, signal) => {
      child = null;
      const cause = new Error(
        `ipcLink: child process exited (code=${code}, signal=${signal})`,
      );
      spawnError = spawnError ?? cause;
      rejectAll(cause);
    });

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk;

      // Only emit complete messages - newline-terminated lines.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          handleLine(line);
        }
      }
    });
  };

  const ipcRequest = (op: Operation): Promise<IPCResult> => {
    return new Promise((resolve, reject) => {
      start();

      if (spawnError) {
        reject(spawnError);
        return;
      }

      /* istanbul ignore if -- @preserve */
      if (!child?.stdin) {
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

      pending.set(op.id, { resolve, reject });

      try {
        child.stdin.write(JSON.stringify(message) + '\n');
      } catch (cause) {
        pending.delete(op.id);
        reject(cause);
      }
    });
  };

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

        const request = ipcRequest(op);
        let meta: IPCResult['meta'] | undefined = undefined;
        request
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
