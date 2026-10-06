import type {
  Audience,
  CatalogHit,
  LibraryItem,
  ProgressChange,
  ProgressCommand,
} from "@ludex/domain";
export type LogInput = {
  title: CatalogHit;
  item?: LibraryItem;
  kind: ProgressChange["kind"];
  commandId: string;
  runId: string;
  day: string;
  rating?: string;
  note?: string;
  liked?: boolean;
  audience?: Audience;
  episodeId?: string;
  minutes?: string;
  playedOn?: string;
  emulator?: string;
  milestone?: string;
  hideSpoilers?: boolean;
};
export function nextEpisodeId(
  title: CatalogHit,
  item?: LibraryItem,
  now = new Date().toISOString(),
) {
  const run = item?.runs.at(-1);
  return [...(title.episodes ?? [])]
    .sort((a, b) => a.order - b.order)
    .find(
      (e) =>
        e.releasedAt &&
        e.releasedAt <= now &&
        !run?.watchedEpisodeIds.includes(e.id) &&
        !run?.skippedEpisodeIds.includes(e.id),
    )?.id;
}
export function buildLog(input: LogInput): ProgressCommand {
  const { title, kind, runId } = input;
  if (title.id === "hidden") throw new Error("This title is concealed.");
  let rating: number | undefined;
  if (input.rating?.trim()) {
    rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10)
      throw new Error("Rating must be a whole number from 1 to 10.");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
    Number.isNaN(Date.parse(input.day))
  )
    throw new Error("Use a valid date as YYYY-MM-DD.");
  if ((input.note?.length ?? 0) > 4000)
    throw new Error("Notes can contain up to 4,000 characters.");
  let change: ProgressChange;
  if (kind === "movie-viewed") {
    if (title.media !== "movie") throw new Error("Choose a movie.");
    change = { kind, titleId: title.id, runId };
  } else if (kind === "episode-watched" || kind === "episode-skipped") {
    if (
      title.media !== "show" ||
      !title.episodes?.some(
        (e) =>
          e.id === input.episodeId &&
          e.releasedAt &&
          e.releasedAt <= new Date().toISOString(),
      )
    )
      throw new Error("Choose a catalog episode.");
    change = { kind, titleId: title.id, runId, episodeId: input.episodeId! };
  } else if (kind === "game-session") {
    if (title.media !== "game") throw new Error("Choose a game.");
    const minutes = input.minutes?.trim() ? Number(input.minutes) : undefined;
    if (
      minutes !== undefined &&
      (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    )
      throw new Error("Session time must be 1–1,440 whole minutes.");
    change = {
      kind,
      titleId: title.id,
      runId,
      ...(minutes === undefined ? {} : { minutes }),
      ...(input.playedOn ? { playedOn: input.playedOn } : {}),
      ...(input.emulator ? { emulator: input.emulator } : {}),
    };
  } else if (kind === "story-completed") {
    if (title.media !== "game") throw new Error("Choose a game.");
    change = { kind, titleId: title.id, runId };
  } else if (kind === "milestone") {
    if (title.media !== "game" || !input.milestone?.trim())
      throw new Error("Add a milestone label.");
    change = {
      kind,
      titleId: title.id,
      runId,
      milestoneId: input.commandId,
      label: input.milestone.trim(),
    };
  } else if (kind === "session-started" || kind === "session-ended") {
    change = {
      kind,
      titleId: title.id,
      runId,
      sessionId: input.commandId,
      medium: title.media,
    };
  } else
    throw new Error("Provider achievements arrive through connected sources.");
  const spoiler = input.hideSpoilers
    ? { kind: "hidden" as const, titleId: title.id }
    : { kind: "none" as const };
  return {
    commandId: input.commandId,
    titleId: title.id,
    baseVersion: input.item?.version ?? 0,
    change,
    occurredAt: { precision: "day", day: input.day },
    audience: input.audience ?? { kind: "private" },
    spoiler,
    ...(rating === undefined ? {} : { rating }),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.liked ? { liked: true } : {}),
  };
}
