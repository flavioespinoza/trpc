# Initial Prompt — Given to Both Models (Identical)

The tRPC client has HTTP and WebSocket links but nothing for talking to a local process over stdio.
This task will be done in 2 phases.

Phase 1

Build an ipcLink that spawns a persistent child process, writes tRPC operations as JSON to stdin, and reads newline-delimited JSON responses from stdout.

Follow the same code structure and use the same error handling that is found in the httpLink. It's important that the stdout receives a complete message. If the process crashes or fails to start, reject whatever requests are still pending.

Phase 1 deliverables
- Filename: `ipcLink.ts`
- Primary Path: `packages/client/src/links/`

Phase 2 task

Create tests using a mock echo script covering the happy path, large payloads, and process crashes.

Phase 2 deliverables
- Exports: Ensure ipcLink is exported in `packages/client/src/links.ts`
- Mock: `packages/client/test/mocks/echo-server.js`

After phase 1 is done we'll review it together before moving on to phase 2.
