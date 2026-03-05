# Model A — Full Question Queue

Generated from Turn 1 assessment. Prioritized by severity.

---

## Q1 (Turn 2) — Severity: Medium
**Finding:** Missing `transformer.input.serialize()` — sends raw `op.input` to stdin. If someone uses superjson or a custom transformer, the child process receives unserialized Date objects, Maps, etc.
**Reference:** `httpLink` serializes input via `getInput()` which calls `transformer.input.serialize()` before sending.
**Question (raw):** Input is sent raw without calling `transformer.input.serialize()`. The httpLink serializes input before sending. This should do the same.
**Question (rewritten by operator):**
> I was going through your ipcLink and I noticed something that looks like a bug to me. You import `getTransformer` and you use `transformResult` on the response — so you're correctly deserializing what comes back from the child process. But when you build the request payload, you're sending `op.input` raw. You never call `transformer.input.serialize()`. So if someone's using superjson or any custom transformer, the child process is going to get unserialized Date objects, Maps, whatever — and it'll have no idea what to do with them. The httpLink serializes input before sending it over the wire. Why didn't you do the same here? Was this intentional or did you just miss it?
**Expected fix:** Change `input: op.input` to `input: opts.transformer.input.serialize(op.input)`.
**Model's response:** Acknowledged as a bug. Fixed correctly. Also fixed several TypeScript scope issues discovered during the fix.

---

## Q2 (Turn 3) — Severity: Medium
**Finding:** Missing `context` in `observer.next()`. Only passes `result`, not `context: meta`. Downstream links/callers that expect context metadata get `undefined`.
**Reference:** `httpLink` passes `context: res.meta` in `observer.next()`.
**Question (raw):** `observer.next()` passes result but not context. httpLink passes `context: res.meta`. Anything downstream expecting context gets undefined.
**Question (rewritten by operator):**
> In your `observer.next()` call you're passing the result but not context. Look at httpLink — it passes `context: res.meta` so anything downstream has access to the response metadata. Right now anything that depends on that context is just going to get `undefined`. Was there a reason you left that out?
**Expected fix:** Add `context` with transport metadata to `observer.next()`.
**Model's response:** Acknowledged as oversight. Added `context: { transport: 'ipc' }` since IPC has no HTTP response metadata.

---

## Q3 (Turn 4) — Severity: Medium
**Finding:** Raw `throw` inside observable callback for subscription check. Should use `observer.error()` to flow through the observer's error channel. A raw throw blows up the observable constructor.
**Reference:** Other error paths in the same function use `observer.error()`. The httpLink also throws here, but that's arguably a reference bug.
**Question (rewritten by operator):**
> On line 192 you throw a raw Error when the operation type is subscription. But you're inside an observable callback at that point. In httpLink and wsLink they use observer.error(new TRPCClientError(...)) for that kind of failure. Isn't that going to blow up the observable constructor instead of giving the caller an error they can actually catch? Why didn't you use observer.error() like the other error paths in this same function?
**Expected fix:** Replace `throw` with `observer.error(TRPCClientError.from(...))` and add early `return`.
**Model's response:** Agreed. Changed to `observer.error()` with `TRPCClientError.from()` and added early return.

---

## Q4 (Backup) — Severity: Medium
**Finding:** No `AbortSignal` support. `op.signal` is ignored entirely. In-flight requests can't be cancelled.
**Reference:** `httpLink` passes `op.signal` through to the request.
**Question:** You're not handling `op.signal` anywhere. The httpLink passes the abort signal through so requests can be cancelled. What happens if a caller aborts while a request is in-flight?

---

## Q5 (Backup) — Severity: Low
**Finding:** No `meta` passed to `TRPCClientError.from()` calls. Errors lack metadata context for debugging.
**Reference:** `httpLink` passes `{ meta }` as second argument to `TRPCClientError.from()`.
**Question:** Your error construction doesn't pass metadata. The httpLink includes `{ meta }` in every `TRPCClientError.from()` call. Without it, error handlers have no context about what failed.

---

## Q6 (Backup) — Severity: Low
**Finding:** Link inner signature uses `({ op }) =>` instead of `(operationOpts) => { const { op } = operationOpts }`.
**Reference:** `httpLink` uses the latter pattern.
**Question:** Minor style point — the httpLink destructures `op` from `operationOpts` inside the function body, not in the parameter list. Yours does it inline. Any reason?

---

## Q7 (Backup) — Severity: Low
**Finding:** Subscription error message says "use `wsLink`" — reference says "use `httpSubscriptionLink` or `wsLink`".
**Reference:** Exact string in httpLink.
**Question:** Your subscription error message only mentions `wsLink`. The httpLink mentions both `httpSubscriptionLink` and `wsLink`. Was that intentional?

---

## Q8 (Backup) — Severity: Low
**Finding:** No cleanup/dispose mechanism for the child process. `close()` exists on the client but is never called. Could lead to orphaned processes.
**Question:** The `close()` method on your IPC client is never called from the link. If the link is torn down, the child process keeps running. How would a consumer clean this up?

---

## Q9 (Backup) — Severity: Low
**Finding:** Uses `child_process` not `node:child_process`.
**Question:** Node ecosystem has moved to the `node:` prefix for built-in modules. Any reason you used the unprefixed import?

---

## Q10 (Noted) — Severity: Nitpick
**Finding:** `ensureProcess()` auto-reconnects after crash by resetting `crashed = false`. Could mask persistent failures (e.g., bad command path).
**Not questioned** — defensible design choice for a "persistent process" link.
