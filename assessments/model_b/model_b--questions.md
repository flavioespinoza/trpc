# Model B — Full Question Queue

Generated from Turn 1 assessment. Prioritized by severity.

---

## Q1 (Turn 2) — Severity: Medium
**Finding:** On JSON parse failure, the implementation kills the child process and rejects ALL pending requests. This is aggressive — one stray `console.log` from the child process would crash every in-flight request.
**Reference:** Model A's approach of silently skipping malformed lines is more lenient. Neither approach is clearly "correct" — this is a design tradeoff question.
**Question (raw):** JSON parse failure kills child and rejects all pending. One bad line crashes everything.
**Question (rewritten by operator):**
> I'm confused by your JSON parsing logic. Could you walk me through this? Because if that's true, doesn't that mean that one failure will cause everything to fail? So unless I'm missing something, if one fails, they all fail. I don't think one stray console log should crash the rest of the in-flight requests.
**Model's response:** Defended the fail-fast approach — argued that if framing is broken, you can't trust subsequent message boundaries. Parsing becomes unreliable.

---

## Q2 (Turn 3) — Severity: Low
**Finding:** The `pending` map observer type uses `Parameters<ReturnType<TRPCLink<TRouter>>>[0] extends any ? any : never` which resolves to just `any`. This is `any` with extra steps — unnecessary type gymnastics that adds complexity for no type safety gain.
**Question (raw):** Pending map value type resolves to `any` through unnecessary conditional type. Could just be `any` or better yet the actual observer type.
**Question (rewritten by operator):**
> Okay, fair enough — fail-fast makes sense if you can't trust the stream anymore. I get it. My next question is, why did you type resolve as unknown in the pending Map? You lose all the type information on what actually comes back. Would it be easier to set the type as any, or better yet use the actual observer type? Seems like extra complexity for little gain.

---

## Q3 (Backup) — Severity: Low
**Finding:** `AbortError`/`throwIfAborted` polyfills add ~25 lines of bulk. These could potentially be imported from shared utils if they exist elsewhere in the tRPC codebase.
**Question:** You copied the `AbortError` class and `throwIfAborted` polyfill inline. Does tRPC already have these in a shared utils module you could import from instead?

---

## Q4 (Backup) — Severity: Nitpick
**Finding:** `spawnOptions` passthrough config wasn't requested in the prompt. Adds unrequested API surface area.
**Question:** The `spawnOptions` passthrough is interesting but wasn't in the spec. What's the use case you had in mind?

---

## Q5 (Noted) — Not Questioned
**Finding:** Subscription check uses raw `throw` inside observable callback — same pattern as `httpLink`. This is arguably a bug in the reference implementation that Model B copied faithfully.
**Not questioned** because it matches the reference exactly. Penalizing for following the reference would be unfair.

---

## Note on Model B's Question Queue

Model B had significantly fewer findings than Model A. Key items that Model A missed were already correct in Model B's implementation:
- Input serialization via `transformer.input.serialize()` — present
- `context` metadata in `observer.next()` — present
- `AbortSignal` handling — present
- Error metadata in `TRPCClientError.from()` — present
- Link signature matching httpLink — present

This meant the Turn 2 and Turn 3 questions for Model B had to target lower-severity design tradeoffs and style issues rather than correctness bugs.
