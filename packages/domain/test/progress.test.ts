import test from "node:test";
import assert from "node:assert/strict";
import {
  nextEpisode,
  normalizeRating,
  reduceProgress,
  emptyLibrary,
} from "../src/progress.ts";
import { canReveal } from "../src/spoilers.ts";
test("TV gaps and skipped episodes do not reveal required spoilers", () => {
  assert.equal(canReveal(new Set(["e1", "e3"]), ["e1", "e2"]), false);
  assert.equal(
    nextEpisode(
      [
        { id: "e1", order: 1, releasedAt: "2026-01-01" },
        { id: "e2", order: 2, releasedAt: "2026-01-02" },
        { id: "e3", order: 3, releasedAt: "2027-01-01" },
      ],
      new Set(["e1"]),
      new Set(),
      "2026-10-06",
    )?.id,
    "e2",
  );
});
test("ratings optional and integer ten point only", () => {
  assert.equal(normalizeRating(undefined), undefined);
  assert.equal(normalizeRating(9), 9);
  assert.throws(() => normalizeRating(4.5));
  assert.throws(() => normalizeRating(11));
});
test("game story completion does not manufacture achievements; rewatches retain runs", () => {
  const game = reduceProgress(emptyLibrary("game"), {
    kind: "story-completed",
    titleId: "game",
    runId: "r1",
  });
  assert.equal(game.runs[0].storyCompleted, true);
  assert.deepEqual(game.achievementIds, []);
  let movie = reduceProgress(emptyLibrary("movie"), {
    kind: "movie-viewed",
    titleId: "movie",
    runId: "r1",
  });
  movie = reduceProgress(movie, {
    kind: "movie-viewed",
    titleId: "movie",
    runId: "r2",
  });
  assert.equal(movie.runs.length, 2);
});
