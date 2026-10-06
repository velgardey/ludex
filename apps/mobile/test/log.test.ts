import { buildLog, nextEpisodeId } from "../src/features/log/model";
import type { CatalogHit, LibraryItem } from "@ludex/domain";
const title: CatalogHit = {
  id: "show",
  title: "Show",
  media: "show",
  providerIds: {},
  episodes: [
    { id: "e1", order: 1, releasedAt: "2020-01-01" },
    { id: "e2", order: 2, releasedAt: "2020-01-02" },
    { id: "e3", order: 3, releasedAt: "2020-01-03" },
  ],
};
const item: LibraryItem = {
  titleId: "show",
  version: 2,
  state: "active",
  achievementIds: [],
  runs: [
    {
      id: "r1",
      watchedEpisodeIds: ["e1", "e3"],
      skippedEpisodeIds: [],
      movieViewed: false,
      storyCompleted: false,
      minutes: 0,
      milestoneIds: [],
      sessionActive: false,
    },
  ],
};
it("selects the unwatched gap in the current TV run", () => {
  expect(nextEpisodeId(title, item, "2026-10-06")).toBe("e2");
});
it("quick logging is private and does not require a rating or note", () => {
  const command = buildLog({
    title: { id: "movie", title: "Film", media: "movie", providerIds: {} },
    kind: "movie-viewed",
    commandId: "stable",
    runId: "run",
    day: "2026-10-06",
  });
  expect(command.rating).toBeUndefined();
  expect(command.note).toBeUndefined();
  expect(command.audience).toEqual({ kind: "private" });
  expect(command.occurredAt).toEqual({ precision: "day", day: "2026-10-06" });
});
it("rejects invented TV episodes and a fractional rating", () => {
  expect(() =>
    buildLog({
      title,
      kind: "episode-watched",
      episodeId: "invented",
      commandId: "x",
      runId: "r",
      day: "2026-10-06",
    }),
  ).toThrow("Choose a catalog episode");
  expect(() =>
    buildLog({
      title: { ...title, media: "movie" },
      kind: "movie-viewed",
      commandId: "x",
      runId: "r",
      day: "2026-10-06",
      rating: "4.5",
    }),
  ).toThrow("whole number");
});
it("game story completion is explicit and does not invent achievements or a playtime", () => {
  const c = buildLog({
    title: { id: "g", title: "Game", media: "game", providerIds: {} },
    kind: "story-completed",
    commandId: "x",
    runId: "r",
    day: "2026-10-06",
  });
  expect(c.change).toEqual({
    kind: "story-completed",
    titleId: "g",
    runId: "r",
  });
});
it("keeps original title platform independent from played device and emulator", () => {
  const c = buildLog({
    title: {
      id: "g",
      title: "Game",
      media: "game",
      providerIds: {},
      platform: "Nintendo GameCube",
    },
    kind: "game-session",
    commandId: "x",
    runId: "r",
    day: "2026-10-06",
    minutes: "45",
    playedOn: "Steam Deck",
    emulator: "Dolphin",
  });
  expect(c.change).toMatchObject({
    minutes: 45,
    playedOn: "Steam Deck",
    emulator: "Dolphin",
  });
});
it("future and unreleased episodes cannot be recorded as viewed", () => {
  expect(() =>
    buildLog({
      title: {
        ...title,
        episodes: [{ id: "future", order: 1, releasedAt: "2099-01-01" }],
      },
      kind: "episode-watched",
      episodeId: "future",
      commandId: "x",
      runId: "r",
      day: "2026-10-06",
    }),
  ).toThrow("Choose a catalog episode");
});
it("concealed catalog titles cannot be logged", () => {
  expect(() =>
    buildLog({
      title: { id: "hidden", title: "Hidden", media: "movie", providerIds: {} },
      kind: "movie-viewed",
      commandId: "x",
      runId: "r",
      day: "2026-10-06",
    }),
  ).toThrow("concealed");
});
it("a user-started timer estimates whole minutes and never a completion", () => {
  const { timerMinutes } = require("../src/features/log/timer");
  expect(timerMinutes(1000, 121000)).toBe(2);
  expect(timerMinutes(null, 121000)).toBeUndefined();
  expect(timerMinutes(121000, 1000)).toBeUndefined();
});
