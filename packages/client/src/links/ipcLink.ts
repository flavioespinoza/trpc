import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { observable } from '@trpc/server/observable';
import type { AnyRouter } from '@trpc/server/unstable-core-do-not-import';
import { TRPCClientError } from '../TRPCClientError';
import type { Operation, TRPCLink } from './types';

/**
 * Options for the IPC link.
 */
export interface IpcLinkOptions {
  /** The command to spawn (e.g. 'node', 'python') */
  command: string;
  /** Arguments passed to the command (e.g. ['server.js']) */
  args?: string[];
  /** An AbortSignal that, when aborted, kills the child process and rejects all pending requests */
  signal?: AbortSignal;
}

/**
 * Wire protocol: request sent to child's stdin as newline-delimited JSON.
 */
interface IpcRequest {
  id: number;
  method: 'query' | 'mutation';
  params: {
    path: string;
    input: unknown;
  };
}

/**
 * Wire protocol: success response from child's stdout.
 */
interface IpcResponseOk {
  id: number;
  result: {
    type: 'data';
    data: unknown;
  };
}

/**
 * Wire protocol: error response from child's stdout.
 */
interface IpcResponseError {
  id: number;
  error: {
    message: string;
    code: number;
    data?: unknown;
  };
}

type IpcResponse = IpcResponseOk | IpcResponseError;

/**
 * A tRPC link that communicates with a child process over stdio.
 *
 * Spawns a persistent child process, sends tRPC operations as newline-delimited
 * JSON to its stdin, and reads newline-delimited JSON responses from its stdout.
 *
 * @see https://trpc.io/docs/client/links
 */
export function ipcLink<TRouter extends AnyRouter>(
  opts: IpcLinkOptions,
): TRPCLink<TRouter> {
  // --- Eagerly spawn the child process ---
  const child: ChildProcess = spawn(opts.command, opts.args ?? [], {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin=pipe, stdout=pipe, stderr=inherit
  });

  // Pending requests: id -> { resolve observer calls }
  const pending = new Map<
    number,
    {
      resolve: (data: unknown) => void;
      reject: (err: TRPCClientError<TRouter>) => void;
    }
  >();

  // Track whether the child is alive
  let dead = false;
  let deathError: TRPCClientError<TRouter> | null = null;

  // --- Buffer accumulator for stdout ---
  // Stdout chunks may arrive split across multiple 'data' events.
  // We accumulate into a buffer and split on newlines.
  let stdoutBuffer = '';

  child.stdout!.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();

    // Process all complete lines
    let newlineIdx: number;
    while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIdx).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);

      if (line.length === 0) {
        continue;
      }

      let response: IpcResponse;
      try {
        response = JSON.parse(line);
      } catch {
        // Malformed JSON from child — skip this line.
        // In production you might want to log this, but we don't
        // want to crash the link over a bad line.
        continue;
      }

      const pendingRequest = pending.get(response.id);
      if (!pendingRequest) {
        // Response for unknown id — child sent something we didn't ask for.
        // Nothing we can do, skip it.
        continue;
      }

      pending.delete(response.id);

      if ('error' in response) {
        pendingRequest.reject(
          new TRPCClientError(response.error.message, {
            result: {
              error: {
                message: response.error.message,
                code: response.error.code,
                data: response.error.data ?? null,
              },
            } as any,
          }),
        );
      } else {
        pendingRequest.resolve(response.result.data);
      }
    }
  });

  // --- Handle child death ---
  function rejectAllPending(error: TRPCClientError<TRouter>) {
    const entries = Array.from(pending.values());
    pending.clear();
    for (const entry of entries) {
      entry.reject(error);
    }
  }

  child.on('error', (err) => {
    dead = true;
    deathError = new TRPCClientError(`IPC child process error: ${err.message}`, {
      cause: err,
    });
    rejectAllPending(deathError);
  });

  child.on('close', (code, signal) => {
    if (!dead) {
      dead = true;
      deathError = new TRPCClientError(
        `IPC child process exited unexpectedly (code=${code}, signal=${signal})`,
      );
      rejectAllPending(deathError);
    }
  });

  // --- AbortSignal for lifecycle teardown ---
  if (opts.signal) {
    const onAbort = () => {
      if (!dead) {
        dead = true;
        deathError = new TRPCClientError('IPC link aborted');
        child.kill();
        rejectAllPending(deathError);
      }
    };

    if (opts.signal.aborted) {
      onAbort();
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  // --- Return the link ---
  return () => {
    return ({ op }: { op: Operation }) => {
      return observable((observer) => {
        // Subscriptions are not supported over IPC
        if (op.type === 'subscription') {
          observer.error(
            new TRPCClientError(
              'Subscriptions are unsupported by `ipcLink` — use `wsLink` or `httpSubscriptionLink`',
            ),
          );
          return;
        }

        // If child is already dead, fail immediately
        if (dead) {
          observer.error(
            deathError ??
              new TRPCClientError('IPC child process is not running'),
          );
          return;
        }

        // Build the wire request
        const request: IpcRequest = {
          id: op.id,
          method: op.type,
          params: {
            path: op.path,
            input: op.input,
          },
        };

        let cancelled = false;

        // Register in pending map
        pending.set(op.id, {
          resolve: (data) => {
            if (cancelled) return;
            observer.next({
              result: {
                type: 'data',
                data,
              },
            });
            observer.complete();
          },
          reject: (err) => {
            if (cancelled) return;
            observer.error(err);
          },
        });

        // Write to child's stdin
        const payload = JSON.stringify(request) + '\n';
        try {
          child.stdin!.write(payload);
        } catch (err) {
          pending.delete(op.id);
          observer.error(
            new TRPCClientError('Failed to write to IPC child stdin', {
              cause: err as Error,
            }),
          );
          return;
        }

        // Per-operation abort: cancel this single request without killing the child
        if (op.signal) {
          const onOperationAbort = () => {
            cancelled = true;
            pending.delete(op.id);
            observer.error(new TRPCClientError('Operation aborted'));
          };

          if (op.signal.aborted) {
            onOperationAbort();
          } else {
            op.signal.addEventListener('abort', onOperationAbort, { once: true });
          }
        }

        // Cleanup function called when observable is unsubscribed
        return () => {
          cancelled = true;
          pending.delete(op.id);
        };
      });
    };
  };
}
