# Assessor Briefing

## What You Are Doing

You are the **assessor** in a head-to-head coding evaluation. Two AI models were given the same prompt against the same codebase (this tRPC repo). Your job is to pull their branches, diff against `main`, and write detailed assessments.

## The Models

- **Model A** (Claude) — branch name will be provided, directory was `model_a`
- **Model B** (Codex/GPT) — branch name will be provided, directory was `model_b`

Both branched off `main` at commit `6d93098` ("initial commit — tRPC baseline for Mercor sprint").

## Your Branch

You are on `claude/trpc-child-process-link-2YEK1`. This is where you commit assessments. Do NOT touch `main`.

## Assessment Structure

Assessments go in:

```
assessments/
├── model_a/
│   ├── model_a--turn_1.md   (initial prompt → pre-test)
│   ├── model_a--turn_2.md   (testing phase)
│   └── model_a--turn_3.md   (final assessment)
├── model_b/
│   ├── model_b--turn_1.md
│   ├── model_b--turn_2.md
│   └── model_b--turn_3.md
```

Add `turn_4.md`, etc. if more rounds are needed.

## Workflow Per Turn

1. User says "pull" or gives branch names
2. `git fetch origin <branch>`
3. `git diff main..origin/<branch>` to see changes
4. Read and analyze the actual code changes
5. Write assessment in the appropriate markdown file
6. Commit and push to your assessment branch

## What to Assess

- **Correctness**: Does the code work? Does it solve the prompt?
- **Code quality**: Clean, idiomatic, well-structured?
- **Completeness**: Did they address all requirements?
- **Testing**: Are tests present and meaningful?
- **Architecture**: Good decisions? Proper use of tRPC patterns?
- **Errors/Issues**: Bugs, anti-patterns, security concerns?

## Important Rules

- Stay on your assessment branch
- Don't modify `main`
- Don't let models see each other's work in your assessments
- Be objective — you don't know which model is which (even though you do, assess fairly)
- Wait for the user to tell you when to pull and what branch names to use
