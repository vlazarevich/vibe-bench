import { z } from 'zod';
import { RatingControl, RatingSelection, TaskKind, toGrade } from './suites.ts';
import { Text } from './text.ts';

export const GradingReviewId = z.uuid().brand<'GradingReviewId'>();
export const GradingSessionId = z.uuid().brand<'GradingSessionId'>();
export const GradingTaskHandle = z.uuid().brand<'GradingTaskHandle'>();
export const GradingCategoryHandle = z.uuid().brand<'GradingCategoryHandle'>();
export const GradingCardHandle = z.uuid().brand<'GradingCardHandle'>();
export const GradingCriterionHandle = z.uuid().brand<'GradingCriterionHandle'>();
export const GradingAssetHandle = z.uuid().brand<'GradingAssetHandle'>();
export const JudgmentValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ungraded') }).strict(),
  z.object({ kind: z.literal('skipped') }).strict(),
  z.object({ kind: z.literal('graded'), selection: RatingSelection }).strict(),
]);
export type JudgmentValue = z.infer<typeof JudgmentValue>;
export const SavedJudgmentValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ungraded') }).strict(),
  z.object({ kind: z.literal('skipped') }).strict(),
  z.object({ kind: z.literal('graded'), selection: RatingSelection, grade: z.number().int().min(0).max(100) }).strict().refine((value) => value.grade === toGrade(value.selection)),
]);
export const Judgment = z.object({ card: GradingCardHandle, criterion: GradingCriterionHandle, version: z.number().int().nonnegative(), value: SavedJudgmentValue }).strict();
export type Judgment = z.infer<typeof Judgment>;
export const SaveJudgment = Judgment.omit({ version: true, value: true }).extend({ expectedVersion: z.number().int().nonnegative(), value: JudgmentValue }).strict();
export type SaveJudgment = z.infer<typeof SaveJudgment>;
export const GradingProgress = z.object({ ungraded: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), graded: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative() }).strict();
export const BlindGradingSession = z.object({ id: GradingSessionId, title: Text, source: z.enum(['fixture', 'live']), categories: z.array(z.object({ handle: GradingCategoryHandle, title: Text, tasks: z.array(z.object({ handle: GradingTaskHandle, title: Text, progress: GradingProgress }).strict()) }).strict()) }).strict();
export type BlindGradingSession = z.infer<typeof BlindGradingSession>;
export const GradingCriterion = z.object({ handle: GradingCriterionHandle, title: Text, instructions: Text, control: RatingControl }).strict();
export type GradingCriterion = z.infer<typeof GradingCriterion>;
export const BlindAsset = z.object({ handle: GradingAssetHandle, kind: z.enum(['image', 'html', 'code', 'recording', 'text']), mediaType: Text, bytes: z.number().int().nonnegative() }).strict();
export const BlindResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: Text }).strict(),
  z.object({ kind: z.enum(['image', 'html', 'code', 'browser']), assets: z.array(BlindAsset) }).strict(),
]);
export type BlindResult = z.infer<typeof BlindResult>;
export const BlindGradingTask = z.object({ handle: GradingTaskHandle, title: Text, prompt: Text, kind: TaskKind, criteria: z.array(GradingCriterion), cards: z.array(z.discriminatedUnion('kind', [
  z.object({ handle: GradingCardHandle, kind: z.literal('completed'), result: BlindResult, judgments: z.array(Judgment) }).strict(),
  z.object({ handle: GradingCardHandle, kind: z.enum(['failed', 'skipped']) }).strict(),
])) }).strict();
export type BlindGradingTask = z.infer<typeof BlindGradingTask>;
export const BlindGradingRuns = z.array(z.object({ reviewId: GradingReviewId, title: Text, source: z.enum(['fixture', 'live']), ready: z.boolean() }).strict());
