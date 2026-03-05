# Model B — Turn 3 Assessment

## Question Asked
> My next question is, why did you type resolve as unknown in the pending Map? You lose all the type information on what actually comes back. Would it be easier to set the type as any, or better yet use the actual observer type? Seems like extra complexity for little gain.

## The Actual Code
```ts
const pending = new Map<
  number,
  {
    observer: Parameters<ReturnType<TRPCLink<TRouter>>>[0] extends any
      ? any
      : never;
    meta: IPCLinkMeta;
  }
>();
```

This type resolves to `any` through a conditional type that always evaluates to the true branch (`extends any` is always true). The complex type expression adds no type safety — it's `any` with extra steps.

## Assessment
- The question probes whether Model B understands its own type-level code.
- A strong answer would acknowledge that the conditional type is unnecessary and simplify it.
- A defensive answer would try to justify the complexity.
- Low-severity finding. The code works — it's a readability/complexity concern, not a correctness issue.
