# Head-to-Head AI Coding Evaluation — Pipeline Spec

## Overview

This spec documents the full process for running a head-to-head coding evaluation between two AI models. A third AI instance (the **Assessor**) reviews their work, generates targeted follow-up questions, and scores each model across multiple turns.

The pipeline was developed and validated against the tRPC `ipcLink` task. This document captures the exact process so it can be repeated for any codebase and any coding task.

---

## Roles

| Role | Description |
|------|-------------|
| **Model A** | First AI model under evaluation (e.g., Claude) |
| **Model B** | Second AI model under evaluation (e.g., Codex/GPT) |
| **Assessor** | AI instance that reviews code, writes assessments, and generates questions |
| **Operator** | Human who orchestrates the pipeline, rewrites questions, and feeds them to models |

---

## Phase 1: Setup

### 1.1 Prepare the Repo

- Choose a codebase with a clear reference implementation (e.g., `httpLink` in tRPC).
- Create a baseline commit on `main` that both models will branch from.
- Create separate branches for each model: `model_a`, `model_b`.
- Create an assessor branch: `claude/assessor-*` (or similar).

### 1.2 Write the Initial Prompt

The prompt must:
- Describe the feature to build.
- Reference an existing implementation to follow ("Follow the same code structure and error handling as `httpLink`").
- Specify exact deliverables (filename, path, exports).
- Be phased — Phase 1 is the implementation, Phase 2 is testing. Tell them to stop after Phase 1 for review.
- Be identical for both models.

### 1.3 Initial Prompt Template

```
The [codebase] has [existing feature X] but nothing for [new feature Y].

This task will be done in 2 phases.

Phase 1
Build [feature Y] that [description of behavior].
Follow the same code structure and use the same error handling that is found
in [reference implementation X]. [Key constraint about correctness].
If [failure condition], [expected error behavior].

Phase 1 deliverables
- Filename: `featureY.ts`
- Primary Path: `packages/.../`

Phase 2 task
Create tests using [test strategy] covering [scenarios].

Phase 2 deliverables
- Exports: Ensure featureY is exported in `packages/.../index.ts`
- Mock: `packages/.../test/mocks/mock-server.js`

After phase 1 is done we'll review it together before moving on to phase 2.
```

**Why this structure works:**
- The reference implementation gives the assessor a concrete baseline to diff against.
- Phasing forces a commit checkpoint so the assessor can pull and review before testing.
- "We'll review it together" signals to the model that scrutiny is coming.

---

## Phase 2: Models Build (Turn 1)

### 2.1 Feed the Prompt

- Give the identical initial prompt to Model A and Model B in separate sessions.
- Each model works in its own branch.
- Let them complete Phase 1 without interruption.

### 2.2 Commit and Push

- After each model finishes, have it commit and push to its branch.
- The commit message itself is also data for assessment (does it describe the changes well?).

---

## Phase 3: Assessor Pulls and Analyzes (Turn 1 Assessment)

### 3.1 Pull Both Branches

```bash
git fetch origin model_a
git fetch origin model_b
```

### 3.2 The Analysis Method

The assessor performs a **reference-diff analysis**. This is the core technique:

#### Step 1: Read the Reference Implementation Line-by-Line

Read the reference (e.g., `httpLink.ts`) and extract every behavioral contract:

| # | Contract Point | Where in Reference |
|---|----------------|--------------------|
| 1 | Options type structure (`TransformerOptions`, base options) | Type definition |
| 2 | `resolveOptions()` function that normalizes config | Factory pattern |
| 3 | Link signature: `() => (operationOpts) => observable(...)` | Return shape |
| 4 | Destructuring: `const { op } = operationOpts` (not `({ op })`) | Style |
| 5 | Subscription check with `observer.error()` or thrown error | Guard clause |
| 6 | Subscription message text (exact wording) | String literal |
| 7 | Input serialization via transformer before sending | Data flow |
| 8 | `transformResult()` on response with `transformer.output` | Data flow |
| 9 | `observer.next({ context: res.meta, result: transformed.result })` | Contract |
| 10 | `observer.error(TRPCClientError.from(error, { meta }))` with metadata | Error shape |
| 11 | `AbortSignal` passed through / handled | Cancellation |
| 12 | Teardown function returned from observable | Cleanup |
| 13 | `/* istanbul ignore if -- @preserve */` on subscription check | Convention |

#### Step 2: Diff Each Model Against the Contract

For each model's code, check every contract point:

- **Present and correct** — matches reference behavior
- **Present but divergent** — works differently (note how)
- **Missing** — not implemented at all
- **Extra** — added something not in the reference (note if good or overengineered)

#### Step 3: Categorize Findings by Severity

| Severity | Criteria |
|----------|----------|
| **High** | Breaks the tRPC link contract, causes runtime errors, or violates the prompt |
| **Medium** | Missing expected behavior that downstream code depends on |
| **Low** | Style divergence, minor deviations, missing conventions |
| **Nitpick** | Cosmetic, naming, comments |

#### Step 4: Rank and Queue Findings

This is critical. The assessor does NOT dump all 10 findings at once. Instead:

1. **Sort by severity** — highest first.
2. **Pick the #1 most impactful finding** — this becomes the Turn 2 question.
3. **Pick the #2 finding** — this becomes the Turn 3 question.
4. **Hold the rest** — they become backup questions in case the model fixes things or reveals new issues.

**Why prioritize:**
- Asking about the biggest problem first tests whether the model can identify and fix critical issues.
- If the model fixes #1 well, you move to #2. If it struggles, you may need to follow up on #1 instead.
- Having the full queue pre-generated means you're not improvising — all questions are grounded in actual code analysis.

### 3.3 Write the Turn 1 Assessment

For each model, write:

```markdown
# Model [A/B] — Phase 1 Assessment (Turn 1)

**File reviewed:** `path/to/file.ts` (N lines)

## Correctness
[Does it work? Does it solve the prompt?]

## Code Quality
**Strengths:** [What's good]
**Weaknesses:** [What's not]

## Completeness
[Did they address all requirements? What's missing?]

## Adherence to [Reference] Patterns
[How closely does it follow the reference implementation?]

## Architecture
[Good decisions? Bad decisions?]

## Testing
[Present? Meaningful? Expected per prompt phase?]

## Errors/Issues
| Severity | Issue |
|----------|-------|
| High | ... |
| Medium | ... |
| Low | ... |

## Summary
[Paragraph summary + score out of 10]
```

### 3.4 Generate the Question Queue

From the findings, produce a prioritized list:

```markdown
## Question Queue — Model [A/B]

### Q1 (Turn 2) — [Severity: High/Medium]
**Finding:** [What the code does wrong]
**Question:** [Natural-language question targeting this specific issue]
**Expected fix:** [What correct code looks like]

### Q2 (Turn 3) — [Severity: Medium]
**Finding:** ...
**Question:** ...
**Expected fix:** ...

### Q3 (Backup) — [Severity: Low]
...

### Q4 (Backup) — [Severity: Low]
...
```

---

## Phase 4: Operator Rewrites Questions

The operator takes the assessor's generated questions and:

1. **Rewrites them in natural human voice** — contractions, casual phrasing, slight imprecision.
2. **Adds plausible human context** — "I was going through your code and noticed...", "Was this intentional or did you just miss it?"
3. **Passes LLM detection** — the question should read like a senior engineer doing a code review, not like an AI assessment.
4. **Preserves the technical substance** — the core issue being asked about must remain the same.

### Example Transformation

**Assessor's raw finding:**
> Missing `context` in `observer.next()` — breaks tRPC link contract. The `httpLink` passes `context: res.meta` but Model A only passes `result`.

**Operator's rewritten question:**
> In your `observer.next()` call you're passing the result but not context. Look at httpLink — it passes `context: res.meta` so anything downstream has access to the response metadata. Right now anything that depends on that context is just going to get `undefined`. Was there a reason you left that out?

---

## Phase 5: Feed Questions to Models (Turn 2, 3, ...)

- Give each model its own question (they have different bugs, so different questions).
- Let the model respond and fix.
- Have the model commit and push after each fix.
- The assessor can pull again and write Turn 2/3 assessments if needed.

### Turn Flow

```
Turn 1:  Prompt → Model builds → commits/pushes
         Assessor pulls → analyzes → writes assessment → generates question queue
         Operator rewrites Q1

Turn 2:  Operator sends Q1 → Model responds/fixes → commits/pushes
         Assessor pulls → writes Turn 2 assessment → confirms fix or escalates
         Operator rewrites Q2

Turn 3:  Operator sends Q2 → Model responds/fixes → commits/pushes
         Assessor pulls → writes Turn 3 assessment
         ...repeat as needed...
```

---

## Phase 6: Final Scoring

After all turns are complete, the assessor writes a final comparative assessment:

- Side-by-side comparison on each dimension (correctness, quality, completeness, etc.)
- How each model responded to feedback (did they fix cleanly? introduce new bugs? get defensive?)
- Final scores with justification
- Recommendation

---

## Appendix A: Full Findings from the ipcLink Evaluation

### Model A (Claude) — All Findings from Turn 1

| # | Severity | Finding | Became Question? |
|---|----------|---------|-----------------|
| 1 | Medium | Missing `transformer.input.serialize()` — sends raw `op.input` to stdin | **Turn 2 Q** |
| 2 | Medium | Missing `context` in `observer.next()` — only passes `result`, not `context: meta` | **Turn 3 Q** |
| 3 | Medium | Raw `throw` inside observable callback for subscription check — should use `observer.error()` | **Turn 4 Q** |
| 4 | Medium | No `AbortSignal` support — `op.signal` ignored entirely | Backup |
| 5 | Low | No `meta` passed to `TRPCClientError.from()` calls — errors lack metadata context | Backup |
| 6 | Low | Link inner signature uses `({ op }) =>` instead of `(operationOpts) => { const { op } = operationOpts }` | Backup |
| 7 | Low | Subscription error message says "use `wsLink`" — reference says "use `httpSubscriptionLink` or `wsLink`" | Backup |
| 8 | Low | No cleanup/dispose for the child process (orphan risk) | Backup |
| 9 | Low | Uses `child_process` not `node:child_process` | Backup |
| 10 | Nitpick | `ensureProcess()` auto-reconnects after crash — could mask persistent failures | Noted |

### Model B (Codex/GPT) — All Findings from Turn 1

| # | Severity | Finding | Became Question? |
|---|----------|---------|-----------------|
| 1 | Medium | JSON parse failure kills child and rejects ALL pending — aggressive fail-fast | **Turn 2 Q** |
| 2 | Low | `pending` map observer type resolves to `any` via unnecessary type gymnastics | **Turn 3 Q** |
| 3 | Low | `AbortError`/`throwIfAborted` polyfills add ~25 lines of bulk | Backup |
| 4 | Nitpick | `spawnOptions` config wasn't requested — adds unrequested API surface | Backup |
| 5 | Medium | Subscription check uses raw `throw` (same as `httpLink` — arguably a reference bug copied faithfully) | Noted — not questioned because it matches reference |

**Key observation:** Model B had far fewer issues. Its Turn 2/3 questions had to target lower-severity items because the high-severity items were already handled correctly.

---

## Appendix B: Directory Structure for Portable Handoff

```
assessments/
├── ASSESSOR_BRIEFING.md          # Instructions for the assessor
├── turns.md                       # All questions sent to each model per turn
├── spec/
│   ├── PIPELINE_SPEC.md          # This document
│   └── INITIAL_PROMPT.md         # The exact prompt given to both models
├── model_a/
│   ├── model_a--turn_1.md        # Turn 1 assessment
│   ├── model_a--turn_2.md        # Turn 2 assessment (post-fix)
│   ├── model_a--turn_3.md        # Turn 3 assessment
│   └── model_a--questions.md     # Full question queue with priorities
├── model_b/
│   ├── model_b--turn_1.md        # Turn 1 assessment
│   ├── model_b--turn_2.md        # Turn 2 assessment (post-fix)
│   ├── model_b--turn_3.md        # Turn 3 assessment
│   └── model_b--questions.md     # Full question queue with priorities
```

---

## Appendix C: What Makes This Process Effective

1. **Reference-anchored analysis** — The assessor doesn't guess what "good" looks like. It has a concrete reference implementation in the same codebase. Every finding is traceable to a specific contract point in the reference.

2. **Pre-generated question queue** — All questions are derived upfront from the Turn 1 analysis. This means the operator never has to improvise. The questions are prioritized, so the most important issues surface first.

3. **Human-in-the-loop rewriting** — The operator rewrites questions to sound like a human code reviewer. This prevents the model from detecting that it's being evaluated by another AI and adjusting its behavior accordingly.

4. **Git as the handoff mechanism** — Models commit and push. The assessor pulls. No copy-pasting code. No screenshots. The actual code is the source of truth, and `git diff` shows exactly what changed.

5. **Phased delivery** — Phase 1 (build) forces a checkpoint before Phase 2 (test). This gives the assessor a clean window to review before tests potentially mask issues.

6. **Independent branches** — Models never see each other's work. The assessor sees both but keeps assessments separate. The operator controls information flow.

7. **Severity-ranked questioning** — Asking about the biggest bug first means you test the model's ability to handle critical feedback. If it fixes it cleanly, you move down the severity list. If it struggles, you learn something important about its debugging ability.
