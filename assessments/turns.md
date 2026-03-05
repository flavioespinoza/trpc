# Assessment Turns

Note: Each turn is written after reviewing the previous response. Only Turn 2 is written now — the rest will follow based on what comes back.

---

## Turn 2

**Model A:**

> I was going through your ipcLink and I noticed something that looks like a bug to me. You import `getTransformer` and you use `transformResult` on the response — so you're correctly deserializing what comes back from the child process.
>
> The problem I see is that you never call `transformer.input.serialize()` because when you build your request payload, you're sending `op.input` raw.
>
> So if someone's using superjson or any custom transformer, the child process is going to get unserialized Date objects, Maps, whatever — and it'll have no idea what to do with them. The httpLink serializes input before sending it over the wire. Why didn't you do the same here? Was this intentional or did you just miss it?

**Model B:**

> I'm confused by your JSON parsing logic. Could you walk me through this? Because if that's true, doesn't that mean that one failure will cause everything to fail? So unless I'm missing something, if one fails, they all fail. I don't think one stray console log should crash the rest of the in-flight requests.

---

## Turn 3

**Model A:**

> In your `observer.next()` call you're passing the `result` but not `context`. Look at `httpLink` — it passes `context: res.meta` so anything downstream has access to the response metadata. Right now anything that depends on that context is just going to get `undefined`. Was there a reason you left that out?

**Model B:**

> Okay, fair enough — fail-fast makes sense if you can't trust the stream anymore. I get it.
>
> My next qestion is, why did you type resolve as unknown in the pending Map? You lose all the type information on what actually comes back.
>
> Would it be easier to set the type as any, or better yet use the actual observer type? Seems like extra complexity for little gain.
