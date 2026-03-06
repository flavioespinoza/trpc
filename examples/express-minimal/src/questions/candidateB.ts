/**
 * Candidate B — Question List
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
    category: 'Design Decisions',
    question:
      'Why does tRPC not use code generation like GraphQL tooling does? What are the implications of that choice?',
    followUp:
      'Are there scenarios where code generation would actually be preferable over tRPC\'s approach?',
    evaluates: 'Critical thinking about architectural tradeoffs',
  },
  {
    id: 2,
    category: 'Links & Composition',
    question:
      'Explain the "links" abstraction in the tRPC client. How is it similar to middleware, and how is it different?',
    followUp:
      'Design a custom link that adds request timing headers and logs slow queries.',
    evaluates: 'Understanding of the link chain pattern and practical application',
  },
  {
    id: 3,
    category: 'Migration',
    question:
      'You have an existing REST API with 40 endpoints. How would you incrementally migrate to tRPC without a big-bang rewrite?',
    followUp:
      'How would you handle external consumers who can\'t use the tRPC client?',
    evaluates: 'Pragmatic migration strategy and backward compatibility',
  },
  {
    id: 4,
    category: 'Context & DI',
    question:
      'How does tRPC context creation work? Walk me through createContext and how it feeds into procedures.',
    followUp:
      'How would you inject a database connection and a logger into context without creating tight coupling?',
    evaluates: 'Dependency injection patterns and context design',
  },
  {
    id: 5,
    category: 'Type Safety Edge Cases',
    question:
      'What happens to type safety when you use `superjson` as a transformer? Where can types still break at runtime?',
    followUp:
      'How would you handle a Date object that arrives as a string because a proxy strips the transformer?',
    evaluates: 'Serialization boundaries and runtime type gaps',
  },
  {
    id: 6,
    category: 'Adapters',
    question:
      'Compare the Express adapter, the Fetch adapter, and the standalone adapter. What determines which one to use?',
    followUp:
      'How would you deploy the same tRPC router to both a Node server and a Cloudflare Worker?',
    evaluates: 'Platform-aware deployment and adapter knowledge',
  },
  {
    id: 7,
    category: 'Security',
    question:
      'What attack vectors exist in a tRPC application that don\'t exist in a traditional REST API?',
    followUp:
      'How do you prevent a client from calling procedures it shouldn\'t have access to if the types are shared?',
    evaluates: 'Security mindset and understanding of the type-sharing model',
  },
  {
    id: 8,
    category: 'React Integration',
    question:
      'How does @trpc/react-query integrate with TanStack Query? What does tRPC add on top of raw useQuery/useMutation?',
    followUp:
      'When would you bypass the tRPC React hooks and use TanStack Query directly?',
    evaluates: 'Frontend integration depth and knowing when to break abstractions',
  },
];

export const candidateBRouter = router({
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

export type CandidateBRouter = typeof candidateBRouter;
