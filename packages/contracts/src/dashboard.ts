import { z } from 'zod';
import { Entrant, ConfiguredRunId } from './configured-runs.ts';
import { RuntimeId, RuntimeRegistration } from './runtime.ts';
import { SuiteId } from './suites.ts';
import { GradingReviewId } from './blind-grading.ts';
export const DashboardRuns = z.array(
  z
    .object({
      id: ConfiguredRunId,
      number: z.number().int().positive(),
      title: z.string(),
      suiteId: SuiteId,
      revision: z.number(),
      runtimeId: RuntimeId,
      runtimeName: z.string(),
      entrants: z.array(Entrant),
      state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
      source: z.enum(['live', 'fixture']),
      tasks: z.object({ total: z.number(), ran: z.number(), passed: z.number() }).strict(),
      createdAt: z.iso.datetime(),
      startedAt: z.iso.datetime().nullable(),
      finishedAt: z.iso.datetime().nullable(),
      canGrade: z.boolean(),
      gradings: z.number().int().nonnegative(),
      reviewId: GradingReviewId,
    })
    .strict(),
);
export type DashboardRun = z.infer<typeof DashboardRuns>[number];
export const DashboardRuntimes = z.array(
  z
    .object({
      id: RuntimeId,
      name: z.string(),
      os: z.string(),
      connected: z.boolean(),
      state: z.enum(['working', 'ready', 'offline']),
      lastSeen: z.iso.datetime().nullable(),
      registration: RuntimeRegistration.nullable(),
      run: z
        .object({ id: ConfiguredRunId, number: z.number(), done: z.number(), total: z.number() })
        .strict()
        .nullable(),
    })
    .strict(),
);
export type DashboardRuntime = z.infer<typeof DashboardRuntimes>[number];
