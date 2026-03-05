In your `observer.next()` call you're passing the `result` but not `context`.

Look at `httpLink` — it passes `context: res.meta` so anything downstream has access to the response metadata.

Right now anything that depends on that context is just going to get `undefined`. Was there a reason you left that out?
