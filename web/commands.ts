import type { CatalogHit, LibraryItem, ProgressCommand } from "@ludex/domain";
export function nextUnwatched(
  title: CatalogHit,
  watched: string[],
  skipped: string[],
) {
  return title.episodes
    ?.filter((e) => e.releasedAt && e.releasedAt <= new Date().toISOString())
    .sort((a, b) => a.order - b.order)
    .find((e) => !watched.includes(e.id) && !skipped.includes(e.id))?.id;
}
export function makeLog(
  title: CatalogHit,
  item: LibraryItem | undefined,
  input: {
    note?: string;
    rating?: number;
    minutes?: number;
    audience: "private" | "public" | "friends";
    episodeId?: string;
    complete?: boolean;
  },
): ProgressCommand {
  const runId = item?.runs[0]?.id ?? crypto.randomUUID();
  const change =
    title.media === "movie"
      ? { kind: "movie-viewed" as const, titleId: title.id, runId }
      : title.media === "show"
        ? {
            kind: "episode-watched" as const,
            titleId: title.id,
            runId,
            episodeId:
              input.episodeId ??
              nextUnwatched(
                title,
                item?.runs[0]?.watchedEpisodeIds ?? [],
                item?.runs[0]?.skippedEpisodeIds ?? [],
              ) ??
              "",
          }
        : input.complete
          ? { kind: "story-completed" as const, titleId: title.id, runId }
          : {
              kind: "game-session" as const,
              titleId: title.id,
              runId,
              minutes: input.minutes ?? 60,
            };
  if (change.kind === "episode-watched" && !change.episodeId)
    throw new Error("Choose an episode before logging.");
  return {
    commandId: crypto.randomUUID(),
    titleId: title.id,
    baseVersion: item?.version ?? 0,
    change,
    occurredAt: { precision: "instant", iso: new Date().toISOString() },
    note: input.note || undefined,
    rating: input.rating,
    audience: { kind: input.audience },
    spoiler: { kind: "none" },
  };
}
