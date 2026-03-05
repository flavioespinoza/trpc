# Model B — Turn 3

> Okay, fair enough — fail-fast makes sense if you can't trust the stream anymore. I get it.
>
> Different thing — I was looking at your `pending` map and the observer type you're storing in it. It looks like you've got this conditional type that just resolves to `any`. Why not just type it as `any` directly, or better yet, use the actual observer type? It feels like unnecessary complexity for no type safety gain.
