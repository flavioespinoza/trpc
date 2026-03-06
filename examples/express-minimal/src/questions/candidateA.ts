/**
 * Candidate A — Question List
 * Fully independent. No knowledge of any other candidate's questions.
 */
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();
const publicProcedure = t.procedure;
const router = t.router;

export interface Question {
  id: number;
  category: string;
  question: string;
  followUp: string;
  evaluates: string;
}

const questions: Question[] = [
  {
    id: 1,
    category: 'Architecture',
    question:
      'Walk me through how a tRPC request flows from client to server. What happens at each layer?',
    followUp:
      'How does type inference travel in the opposite direction — from server to client — without code generation?',
    evaluates: 'Deep understanding of the tRPC transport and type system',
  },
  {
    id: 2,
    category: 'Middleware',
    question:
      'How would you implement authorization middleware in tRPC that attaches a user object to the context?',
    followUp:
      'What happens to the type of `ctx` in downstream procedures after your middleware runs?',
    evaluates: 'Practical middleware design and context augmentation',
  },
  {
    id: 3,
    category: 'Error Handling',
    question:
      'A procedure throws a TRPCError with code UNAUTHORIZED. Trace what happens to that error before the client receives it.',
    followUp:
      'How would you add a global error formatter that strips stack traces in production?',
    evaluates: 'Error pipeline knowledge and production hardening',
  },
  {
    id: 4,
    category: 'Performance',
    question:
      'Explain the difference between httpLink, httpBatchLink, and httpBatchStreamLink. When would you pick each one?',
    followUp:
      'What are the tradeoffs of batching — when does it actually hurt performance?',
    evaluates: 'Transport-level optimization and real-world tradeoff analysis',
  },
  {
    id: 5,
    category: 'Subscriptions',
    question:
      'How do tRPC subscriptions work under the hood? Compare the WebSocket approach vs SSE.',
    followUp:
      'How would you handle reconnection and missed events in a subscription-based feature?',
    evaluates: 'Real-time systems design and failure recovery',
  },
  {
    id: 6,
    category: 'Testing',
    question:
      'How would you unit test a tRPC procedure without spinning up an HTTP server?',
    followUp:
      'When would you use createCaller vs a full integration test with a real server?',
    evaluates: 'Testing strategy and understanding of the caller API',
  },
  {
    id: 7,
    category: 'Input Validation',
    question:
      'You have a procedure that accepts complex nested input. How does Zod validation integrate with tRPC, and what happens when validation fails?',
    followUp:
      'How would you share validation schemas between client-side forms and server procedures?',
    evaluates: 'Schema design and validation pipeline',
  },
  {
    id: 8,
    category: 'Scaling',
    question:
      'Your tRPC monolith has 500+ procedures. How do you organize them? What patterns keep it maintainable?',
    followUp:
      'How does lazy loading of routers work, and when is it worth the complexity?',
    evaluates: 'Large-scale architecture and code organization',
  },
];

export const candidateARouter = router({
  list: publicProcedure.query(() => {
    return questions;
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const q = questions.find((q) => q.id === input.id);
      if (!q) throw new Error(`Question ${input.id} not found`);
      return q;
    }),

  getByCategory: publicProcedure
    .input(z.object({ category: z.string() }))
    .query(({ input }) => {
      return questions.filter(
        (q) => q.category.toLowerCase() === input.category.toLowerCase(),
      );
    }),

  count: publicProcedure.query(() => {
    return { total: questions.length };
  }),
});

export type CandidateARouter = typeof candidateARouter;
