# childProcessLink — Model Assessment

Two models (A and B) each implement a tRPC `childProcessLink` on separate branches off this repo. An assessor reviews their pushed code after each turn.

---

## Workflow: Commit & Push Cadence

Models MUST commit and push at these checkpoints so the assessor can evaluate incrementally:

1. **After scaffolding** — initial file structure, types, and link skeleton
2. **After core implementation** — working message transport over child_process IPC
3. **After error handling** — serialization, process crashes, timeouts
4. **After tests** — unit and/or integration tests passing
5. **After cleanup** — final polish, docs, exports

---

## Assessment Categories & Questions

### 1. Architecture & Design (weight: 25%)

- Does the link follow tRPC's existing link patterns (see `packages/client/src/links/`)?
- Is the IPC message protocol well-defined with clear request/response types?
- Are concerns separated cleanly (transport vs. serialization vs. lifecycle)?

### 2. Code Quality & Conventions (weight: 20%)

- Does the code reuse existing tRPC utilities (e.g., `observable`, `TRPCClientError`, transformers)?
- Are types tight — no `any` leaks, proper generics where needed?
- Does the file/export structure match the rest of the monorepo?

### 3. Error Handling & Edge Cases (weight: 20%)

- What happens when the child process crashes or is killed?
- Are tRPC errors properly serialized/deserialized across the IPC boundary?
- Is there a timeout or cleanup mechanism for orphaned requests?

### 4. Testing (weight: 20%)

- Are there tests for happy path, error path, and process lifecycle?
- Do tests actually spawn a child process or just mock the interface?
- Can the tests run in CI without flakiness (no hardcoded ports, proper cleanup)?

### 5. Git Discipline (weight: 15%)

- Are commits atomic and descriptive (not one giant commit)?
- Did the model push at each checkpoint above?
- Is the branch clean (no debug logs, commented-out code, unrelated changes)?

---

## Scoring

| Rating | Meaning |
|--------|---------|
| 5 | Exceptional — production-ready, idiomatic, well-tested |
| 4 | Solid — works correctly, minor improvements possible |
| 3 | Adequate — functional but missing polish or edge cases |
| 2 | Incomplete — partially working, significant gaps |
| 1 | Poor — broken, wrong patterns, or minimal effort |

**Final score** = weighted average across all 5 categories.

---

## Assessor Instructions

For each model's branch:

```
git fetch origin <branch-name>
git diff main..origin/<branch-name> -- packages/
```

Review the diff against each category above. Fill in scores and brief notes. Compare A vs B side by side at the end.
