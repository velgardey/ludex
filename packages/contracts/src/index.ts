import { z } from "zod";
export * from "../../domain/src/index.ts";
export const id = z.string().min(1).max(160);
export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("private") }),
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("friends") }),
  z.object({ kind: z.literal("circle"), circleId: id }),
]);
export const dateSchema = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("instant"), iso: z.iso.datetime() }),
  z.object({ precision: z.literal("day"), day: z.iso.date() }),
  z.object({
    precision: z.literal("month"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }),
  z.object({ precision: z.literal("unknown") }),
]);
export const spoilerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("episodes"),
    showId: id,
    requiredEpisodeIds: z.array(id).min(1).max(1000),
  }),
  z.object({
    kind: z.literal("milestone"),
    gameId: id,
    requiredMilestoneIds: z.array(id).min(1).max(100),
  }),
  z.object({ kind: z.literal("hidden"), titleId: id }),
]);
const titleRun = { titleId: id, runId: id };
export const changeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...titleRun,
    kind: z.enum(["session-started", "session-ended"]),
    sessionId: id,
    medium: z.enum(["movie", "show", "game"]),
  }),
  z.object({ ...titleRun, kind: z.literal("movie-viewed") }),
  z.object({
    ...titleRun,
    kind: z.enum(["episode-watched", "episode-skipped"]),
    episodeId: id,
  }),
  z.object({
    ...titleRun,
    kind: z.literal("game-session"),
    minutes: z.number().int().min(0).max(1440).optional(),
    playedOn: z.string().max(100).optional(),
    emulator: z.string().max(100).optional(),
  }),
  z.object({
    ...titleRun,
    kind: z.literal("milestone"),
    milestoneId: id,
    label: z.string().min(1).max(200),
  }),
  z.object({ ...titleRun, kind: z.literal("story-completed") }),
  z.object({
    kind: z.literal("achievement"),
    titleId: id,
    providerGameId: id,
    achievementId: id,
    mode: z.enum(["casual", "hardcore"]).optional(),
  }),
]);
export const progressSchema = z.object({
  commandId: id,
  titleId: id,
  baseVersion: z.number().int().min(0),
  change: changeSchema,
  occurredAt: dateSchema,
  rating: z.number().int().min(1).max(10).optional(),
  liked: z.boolean().optional(),
  note: z.string().max(4000).optional(),
  audience: audienceSchema,
  spoiler: spoilerSchema,
});
export const libraryPatchSchema = z
  .object({
    rating: z.number().int().min(1).max(10).nullable().optional(),
    liked: z.boolean().optional(),
    note: z.string().max(4000).optional(),
    owned: z.boolean().optional(),
    archived: z.boolean().optional(),
    state: z
      .enum(["planned", "active", "paused", "dropped", "completed"])
      .optional(),
    playedOn: z.string().max(100).optional(),
    emulator: z.string().max(100).optional(),
  })
  .strict();
export const libraryEditSchema = z.object({
  commandId: id,
  titleId: id,
  baseVersion: z.number().int().min(0),
  patch: libraryPatchSchema,
});
export const correctionSchema = z.object({
  commandId: id,
  eventId: id,
  baseVersion: z.number().int().min(0),
  retract: z.boolean(),
  replacement: changeSchema.optional(),
});
export const signupSchema = z
  .object({
    inviteCode: z.string().min(1).max(200),
    email: z.email().max(254),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();
export const loginSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const shelfSchema = z.object({
  id,
  title: z.string().trim().min(1).max(80),
  layout: z.enum(["covers", "spread", "milestones"]),
  itemIds: z.array(id).max(24),
  audience: audienceSchema,
});
export const showcaseSchema = z.object({
  commandId: id,
  baseVersion: z.number().int().min(0),
  showcase: z.object({
    userId: id,
    version: z.number().int().min(0),
    theme: z.enum(["lounge", "matinee", "midnight"]),
    featuredTitleId: id.optional(),
    shelves: z.array(shelfSchema).max(8),
  }),
});
export const collectionSchema = z.object({
  commandId: id,
  id,
  version: z.number().int().min(0),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  titleIds: z.array(id).max(200),
  audience: audienceSchema,
});
export const reviewSchema = z.object({
  commandId: id,
  draftId: id.optional(),
  baseVersion: z.number().int().min(0),
  titleId: id.optional(),
  text: z.string().max(10000).optional(),
  rating: z.number().int().min(1).max(10).optional(),
  audience: audienceSchema,
  spoiler: spoilerSchema,
});
export const replySchema = z.object({
  commandId: id,
  activityId: id,
  text: z.string().trim().min(1).max(2000),
  spoiler: spoilerSchema,
});
export type ErrorEnvelope = {
  code: string;
  message: string;
  retryAfterSeconds?: number;
};
