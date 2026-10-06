import type { Episode, LibraryItem, ProgressChange, Run } from "./types.ts";
export function normalizeRating(value: number | undefined) {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1 || value > 10)
  )
    throw new Error("rating-range");
  return value;
}
export function nextEpisode(
  episodes: Episode[],
  watched: Set<string>,
  skipped: Set<string>,
  now: string,
): Episode | null {
  return (
    [...episodes]
      .sort((a, b) => a.order - b.order)
      .find(
        (e) =>
          e.releasedAt !== null &&
          e.releasedAt <= now &&
          !watched.has(e.id) &&
          !skipped.has(e.id),
      ) ?? null
  );
}
export const emptyLibrary = (titleId: string): LibraryItem => ({
  titleId,
  version: 0,
  state: "planned",
  runs: [],
  achievementIds: [],
});
export function reduceProgress(
  item: LibraryItem,
  change: ProgressChange,
): LibraryItem {
  const result = structuredClone(item);
  if (change.kind === "achievement") {
    const key = `${change.providerGameId}:${change.achievementId}:${change.mode ?? "casual"}`;
    if (!result.achievementIds.includes(key)) result.achievementIds.push(key);
    return result;
  }
  let run = result.runs.find((r) => r.id === change.runId);
  if (!run) {
    run = {
      id: change.runId,
      watchedEpisodeIds: [],
      skippedEpisodeIds: [],
      movieViewed: false,
      storyCompleted: false,
      minutes: 0,
      milestoneIds: [],
      sessionActive: false,
    };
    result.runs.push(run);
  }
  const add = (list: string[], id: string) => {
    if (!list.includes(id)) list.push(id);
  };
  switch (change.kind) {
    case "movie-viewed":
      run.movieViewed = true;
      result.state = "completed";
      break;
    case "episode-watched":
      add(run.watchedEpisodeIds, change.episodeId);
      run.skippedEpisodeIds = run.skippedEpisodeIds.filter(
        (id) => id !== change.episodeId,
      );
      result.state = "active";
      break;
    case "episode-skipped":
      add(run.skippedEpisodeIds, change.episodeId);
      run.watchedEpisodeIds = run.watchedEpisodeIds.filter(
        (id) => id !== change.episodeId,
      );
      result.state = "active";
      break;
    case "game-session":
      run.minutes += change.minutes ?? 0;
      run.playedOn = change.playedOn;
      run.emulator = change.emulator;
      result.state = "active";
      break;
    case "milestone":
      add(run.milestoneIds, change.milestoneId);
      result.state = "active";
      break;
    case "story-completed":
      run.storyCompleted = true;
      result.state = "completed";
      break;
    case "session-started":
      run.sessionActive = true;
      result.state = "active";
      break;
    case "session-ended":
      run.sessionActive = false;
      break;
  }
  return result;
}
export function spoilerIds(item: LibraryItem | undefined): Set<string> {
  return new Set(
    item?.runs.flatMap((r: Run) => [
      ...r.watchedEpisodeIds,
      ...r.milestoneIds,
      ...(r.movieViewed || r.storyCompleted ? [item.titleId] : []),
    ]) ?? [],
  );
}
