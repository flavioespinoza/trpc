# Model A — Phase 1 Assessment (Turn 1)

**File reviewed:** `packages/client/src/links/ipcLink.ts` (208 lines)

---

## Correctness

The implementation correctly:
- Spawns a persistent child process via `spawn` with `stdio: ['pipe', 'pipe', 'inherit']`
- Writes newline-delimited JSON to stdin with `JSON.stringify(payload) + '\n'`
- Buffers stdout and parses complete lines (handles partial chunks correctly)
- Correlates responses to requests by `id`
- Rejects all pending requests on process crash (`error` event) or exit (`close` event)
- Blocks subscriptions with an appropriate error message

**Minor issues:**
- Uses `child_process` import path instead of `node:child_process`. Not a bug, but the Node.js ecosystem has moved toward the `node:` prefix.
- The `close` event is used instead of `exit`. Both work, but `close` fires after stdio streams close, which is fine here since stdout is being read. This is actually a reasonable choice.

## Code Quality

**Strengths:**
- Clean separation: `resolveIPCLinkOptions()` -> `createIPCClient()` -> `ipcLink()` — mirrors the `resolveHTTPLinkOptions` / requester / `httpLink` pattern.
- The `ensureProcess()` function is well-structured — it lazily spawns and handles reconnection after crashes.
- Buffer parsing logic is correct and handles edge cases (empty lines, partial reads).
- The stdin write callback properly handles write errors by cleaning up the pending map.

**Weaknesses:**
- `ensureProcess()` resets `crashed = false` at the top, meaning it auto-reconnects after a crash. This could mask persistent failures (e.g., bad command path). However, this is a reasonable design choice for a "persistent process" link — auto-recovery is arguably desirable.
- The `IPCRequest` interface is defined but only used internally. Not a problem, just noting it.

## Completeness

- Meets all Phase 1 requirements: file created at correct path, spawns child, JSON over stdin/stdout, rejects on crash.
- **Missing: no `AbortSignal` handling.** The `httpLink` passes `op.signal` through, but Model A ignores it entirely. The teardown function is a no-op comment. This means in-flight requests can't be cancelled.
- **Missing: no `context` on the observer result.** The `httpLink` passes `context: res.meta` in `observer.next()`, but Model A only passes `result`. This breaks the tRPC link contract — downstream links/callers that expect context metadata won't get it.

## Adherence to httpLink Patterns

- The overall structure follows `httpLink` well: `resolveOptions` -> factory -> observable pattern.
- BUT the inner link signature uses `({ op }) =>` instead of `(operationOpts) => { const { op } = operationOpts; }` as in `httpLink`. Functionally equivalent but diverges from the reference style.
- Does NOT use `TRPCClientError.from(cause, { meta })` with a meta object on errors. The `httpLink` passes `meta` to error construction. Model A passes errors without metadata context.
- The subscription error message says "use `wsLink`" while `httpLink` says "use `httpSubscriptionLink` or `wsLink`". Minor but shows incomplete reference following.

## Architecture

- The `createIPCClient` abstraction is a good architectural decision — it encapsulates process lifecycle and request correlation, keeping the link function clean.
- Process reuse (persistent child) is correctly implemented via `ensureProcess()`.
- The `close()` method on the client is exposed but never called. There's no cleanup path for when the link is torn down. This could lead to orphaned processes.

## Testing

No tests included (Phase 2), as expected per the prompt.

## Errors/Issues

| Severity | Issue |
|----------|-------|
| Medium | Missing `context` in `observer.next()` — breaks tRPC link contract |
| Medium | No `AbortSignal` support — requests can't be cancelled |
| Low | No meta passed to `TRPCClientError.from()` calls |
| Low | No cleanup/dispose mechanism for the child process |
| Low | `node:child_process` not used (stylistic) |

## Summary

A clean, focused implementation that gets the core mechanics right. The code is readable, the buffer parsing is solid, and the architecture follows `httpLink` patterns at a high level. The main gaps are the missing `context` on results and lack of `AbortSignal` support — both of which are present in `httpLink` and expected in a conforming tRPC link. The error metadata omission is a smaller but notable deviation from the reference implementation.

**Score: 7/10** — Solid foundation, but the missing contract compliance (`context`, `signal`) would need to be addressed before this is production-ready.
