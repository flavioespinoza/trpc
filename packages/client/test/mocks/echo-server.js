/**
 * Veritas Mock Engine (JS version)
 * Updates the existing echo-server.js to support hang simulation for watchdog testing.
 */
import { b64js } from './utils.js'; // if applicable

process.stdin.on('data', async (chunk) => {
  const lines = chunk.toString().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const req = JSON.parse(line);
    const { id, method, params } = req;

    // --- WATCHDOG TEST LOGIC ---
    if (params.path === '__hang__') {
      const waitMs = params.input?.ms || 10000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    // --- CRASH TEST LOGIC ---
    if (params.path === '__crash__') {
      process.exit(1);
    }

    // --- ECHO LOGIC ---
    const response = {
      id,
      result: {
        type: 'data',
        data: params.input
      }
    };

    process.stdout.write(JSON.stringify(response) + '\n');
  }
});
