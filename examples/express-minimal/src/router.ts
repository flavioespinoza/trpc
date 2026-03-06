import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { candidateARouter } from './questions/candidateA';
import { candidateBRouter } from './questions/candidateB';

const t = initTRPC.create();

const publicProcedure = t.procedure;
const router = t.router;

export const appRouter = router({
  hello: {
    greeting: publicProcedure
      .input(z.object({ name: z.string() }).nullish())
      .query(({ input }) => {
        return `Hello ${input?.name ?? 'World'}`;
      }),
  },

  // Candidate A questions — independent, no knowledge of B
  candidateA: candidateARouter,

  // Candidate B questions — independent, no knowledge of A
  candidateB: candidateBRouter,
});

export type AppRouter = typeof appRouter;
