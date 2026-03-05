# Model B — Phase 1 Assessment (Turn 1)

**File reviewed:** `packages/client/src/links/ipcLink.ts` (359 lines)

---

## Correctness

The implementation correctly:
- Spawns a persistent child process via `spawn` with `stdio: 'pipe'`
- Writes newline-delimited JSON to stdin
- Buffers stdout with proper NDJSON parsing (handles `\r\n` line endings too)
- Correlates responses to requests by `id`
- Rejects all pending requests on `error` and `exit` events
- Blocks subscriptions with an appropriate error message
- Handles `AbortSignal` — cancels pending requests if the signal fires
- Serializes input through the transformer before sending (`transformer.input.serialize`)
- Supports batched responses (arrays of messages)

**No correctness bugs found.** The implementation handles all the specified requirements.

## Code Quality

**Strengths:**
- Excellent helper extraction: `parseNdjsonChunk()`, `getResponseId()`, `formatExitMessage()` — each is small, testable, and single-purpose.
- The NDJSON parser correctly handles `\r\n` line endings (Windows compatibility).
- Error meta is rich and structured (`IPCLinkMeta` type) — includes command, args, pid, exit info, and raw response JSON. This is very useful for debugging.
- The `AbortSignal` listener is properly cleaned up with `removeEventListener` in the teardown.
- Explicit `stdin.destroyed` check before writing.

**Weaknesses:**
- The `AbortError` polyfill and `throwIfAborted` polyfill add ~25 lines that are arguably unnecessary overhead. These are copied from elsewhere in the tRPC codebase (likely `httpUtils`), which shows good pattern-following, but inflates the file.
- The `pending` map value type uses a complex conditional type (`Parameters<ReturnType<TRPCLink<TRouter>>>[0] extends any ? any : never`) that resolves to just `any`. This is effectively `any` with extra steps — could be simplified.
- `spawnOptions` is exposed as a config option, which adds API surface. This is forward-thinking but wasn't requested.
- On JSON parse failure, the implementation kills the child process and rejects ALL pending requests. This is a defensible "fail fast" choice but is more aggressive than Model A's approach of just skipping malformed lines.

## Completeness

- **Exceeds Phase 1 requirements** in several areas:
  - `AbortSignal` support (matching `httpLink` behavior)
  - `context` metadata on `observer.next()` (matching `httpLink` contract)
  - Input transformer serialization (Model A sends raw input)
  - Batched response support
  - `spawnOptions` passthrough
  - Rich error metadata (`IPCLinkMeta`)

## Adherence to httpLink Patterns

- **Very close adherence.** The link function signature matches `httpLink` exactly: `(operationOpts) => { const { op } = operationOpts; ... }`
- Uses `TRPCClientError.from(cause, { meta })` with metadata — matches `httpLink` pattern.
- Passes `context: meta` in `observer.next()` — matches `httpLink`'s `context: res.meta`.
- Subscription error message includes both `httpSubscriptionLink` and `wsLink` — exact match to `httpLink`.
- The `/* istanbul ignore if -- @preserve */` comment on the subscription check is copied directly from `httpLink`.
- Uses `getTransformer` and `TransformerOptions` from `unstable-internals` — same as `httpLink`.
- Properly serializes input via `transformer.input.serialize()` before sending — mirrors how `httpLink` transforms input before the HTTP request.

## Architecture

- State management is kept at the link level (not in a separate client object). This is slightly different from Model A's approach but works well since the state is tightly coupled to the link lifecycle.
- The `ensureChild()` function with `childAlive` flag is clear and straightforward.
- Error handling on `ensureChild()` failure uses try/catch with proper cleanup.
- The teardown function properly removes the abort listener and cleans up the pending map entry.

## Testing

No tests included (Phase 2), as expected per the prompt.

## Errors/Issues

| Severity | Issue |
|----------|-------|
| Low | `AbortError` / `throwIfAborted` polyfills add bulk — could import from shared utils if they exist |
| Low | `pending` map observer type resolves to `any` via unnecessary type gymnastics |
| Low | JSON parse failure kills the entire child process (aggressive but defensible) |
| Nitpick | `spawnOptions` wasn't requested in the prompt — adds unrequested API surface |

## Summary

A thorough, well-crafted implementation that closely follows `httpLink` patterns. It handles every edge case from the reference: `AbortSignal`, `context` metadata, error metadata, input transformation, and even batched responses. The code is longer (359 vs 208 lines) but the extra lines are justified by real functionality, not bloat (aside from the abort polyfills). The helper functions are well-extracted and testable.

The main critique is that it does more than was asked — `spawnOptions`, batched responses, and the abort polyfills add complexity. But the extra work demonstrates strong understanding of the tRPC link contract and produces a more production-ready result.

**Score: 9/10** — Near-complete implementation that closely mirrors the reference. The only deductions are for minor type complexity and slightly exceeding the requested scope.
