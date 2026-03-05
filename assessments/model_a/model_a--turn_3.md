# Model A — Turn 3

> Okay, I understand now. That makes sense.
>
> One other thing — I noticed that in your `observer.next()` call, you're only passing the `result` but you're not including `context`. If you look at how `httpLink` does it, it passes `context: res.meta` so that downstream consumers can access response metadata. Right now anything that depends on that context is just going to get `undefined`. Was there a reason you left that out?
