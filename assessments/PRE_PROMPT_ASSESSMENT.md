# Pre-Prompt Assessment — Backup Question Bank

After the Turn 1 code review, the assessor analyzed both models' implementations against the `httpLink` reference and identified every deviation, bug, and design choice worth probing. These were turned into a bank of possible follow-up prompts, organized by topic and prioritized by severity.

**How to use this file:**
- Start with Turn 1 (the initial build prompt). After that, pick questions based on what actually needs probing — the biggest issue first.
- You don't have to use these in order. If things diverge (model fixes something, introduces a new bug, goes off-track), adapt.
- These are fallbacks. If the model's response to Turn 2 reveals something new, ask about that instead of mechanically moving to the next one here.
- The operator rewrites these into natural human voice before sending to the model.

**Why this exists:**
Coming up with good prompts on the fly is the hardest part of the process. By doing a full upfront assessment of the code and generating all possible questions at once, we front-load the hard work. The assessor reads the actual code (via `git diff` against the reference), not just the session transcript — that's what makes the questions sharp.

---

## Turn 2 — Buffer Parsing & NDJSON Logic

**Model A prompt:**
> "Model A's buffer parsing splits on newlines and skips empty lines. But what happens if the child process writes a partial JSON object that spans two chunks? Walk me through exactly how `ensureProcess()` handles that. Also, you noted there's no `AbortSignal` support — show me where in the code that gap exists and what it would take to add it."

**Model B prompt:**
> "Model B has a dedicated `parseNdjsonChunk()` helper that also handles `\r\n`. But you said on JSON parse failure it kills the entire child process and rejects ALL pending requests. Show me that code path — is that really the right call? What if one malformed line comes through but the process is otherwise healthy?"

---

## Turn 3 — AbortSignal & Cancellation

**Model A prompt:**
> "You flagged Model A for missing AbortSignal support. The teardown function is apparently a no-op. Show me the exact code and explain what a caller would experience if they tried to cancel an in-flight IPC request. How does this compare to what httpLink does?"

**Model B prompt:**
> "Model B implements AbortSignal with a polyfill for `AbortError` and `throwIfAborted`. That's ~25 extra lines. Is that polyfill actually necessary given tRPC's minimum Node version? Could they have just used the native `AbortSignal.throwIfAborted()`? Show me the code."

---

## Turn 4 — Context Metadata & Link Contract

**Model A prompt:**
> "You said Model A is missing `context` in `observer.next()`, which breaks the tRPC link contract. Show me the exact line where this happens and what downstream code would break. How serious is this in practice — would a basic tRPC app notice?"

**Model B prompt:**
> "Model B passes `context: meta` with rich `IPCLinkMeta` including pid, command, args, and exit info. Is this actually useful or is it over-engineering? Does httpLink provide this level of detail in its context? Show me the type definition."

---

## Turn 5 — Error Handling Comparison

**Model A prompt:**
> "When Model A's child process crashes, `ensureProcess()` auto-reconnects by resetting `crashed = false`. You called this a potential issue for masking persistent failures. Show me the reconnection logic — is there any backoff? Any retry limit? What happens if the command path is wrong and it crashes on every spawn?"

**Model B prompt:**
> "Model B's error handling uses `TRPCClientError.from(cause, { meta })` with structured metadata. Model A doesn't pass meta to errors. Pull up both error paths side by side — what information does a developer get from Model B's errors vs Model A's when debugging a production failure?"

---

## Turn 6 — Transformer & Serialization

**Model A prompt:**
> "You noted Model A sends raw input without running it through the transformer. Show me the line where it builds the request payload. If a tRPC app uses a custom transformer like superjson, would Model A's link silently send unserialized data? How bad is this bug?"

**Model B prompt:**
> "Model B imports `getTransformer` from unstable-internals and serializes input. Show me how this works in the code. Is using `unstable-internals` a risk? What happens if that internal API changes in a future tRPC version?"

---

## Turn 7 — Process Lifecycle & Cleanup

**Model A prompt:**
> "Model A exposes a `close()` method on the IPC client but you said it's never called. Show me the code. If I create an ipcLink, use it, then want to shut down cleanly — how do I kill the child process? Is there a memory/process leak here?"

**Model B prompt:**
> "Model B manages state at the link level without a separate client object. How does cleanup work when the link is torn down? Is there a way to kill the child process? What happens to orphaned processes if the parent Node process exits unexpectedly?"

---

## Turn 8 — httpLink Conformance Checklist

**Model A prompt:**
> "Do a strict checklist of every behavioral contract in httpLink and mark which ones Model A implements. Include: observable pattern, subscription blocking, AbortSignal, context metadata, error meta, transformer usage, link signature style. Give me a pass/fail table."

**Model B prompt:**
> "Same checklist for Model B. Mark every httpLink contract point as pass/fail. Where Model B goes beyond httpLink (batching, spawnOptions), note whether that's a positive or a risk."

---

## Turn 9 — Security Review

**Model A prompt:**
> "Review Model A for security concerns. The link spawns a child process with user-provided command/args. Is there any input validation? Could a malicious config lead to command injection? What about the JSON parsing — is there a prototype pollution risk from `JSON.parse` on untrusted child output?"

**Model B prompt:**
> "Same security review for Model B. They expose `spawnOptions` as a config option — does that widen the attack surface? Their `parseNdjsonChunk` does `JSON.parse` on child output — any concerns? What about the `stdin.destroyed` check — is that sufficient to prevent write-after-close crashes?"

---

## Turn 10 — Final Verdict

**Model A prompt:**
> "Write the final assessment for Model A (turn_3). Summarize all findings across turns, give a final score, and state whether this implementation is production-ready. List the top 3 things that must be fixed before merging."

**Model B prompt:**
> "Write the final assessment for Model B (turn_3). Summarize all findings across turns, give a final score, and state whether this implementation is production-ready. List any concerns that should be addressed before merging."
