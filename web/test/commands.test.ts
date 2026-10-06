import { expect, test } from "vitest";
import { makeLog, nextUnwatched } from "../commands";
test("TV log selects the first missing episode, never the max seen", () => {
  const title = {
    id: "show",
    media: "show" as const,
    title: "Show",
    providerIds: {},
    episodes: [
      { id: "e1", order: 1, releasedAt: "2025-01-01" },
      { id: "e2", order: 2, releasedAt: "2025-01-02" },
      { id: "e3", order: 3, releasedAt: "2025-01-03" },
    ],
  };
  expect(nextUnwatched(title, ["e1", "e3"], [])).toBe("e2");
  const command = makeLog(title, undefined, {
    note: "Quiet night",
    audience: "private",
  });
  expect(command.audience).toEqual({ kind: "private" });
  expect(command.change.kind).toBe("episode-watched");
  expect(command.rating).toBeUndefined();
});
test("game session records minutes without inventing story completion", () => {
  const command = makeLog(
    { id: "game", media: "game", title: "Game", providerIds: {} },
    undefined,
    { minutes: 45, audience: "public" },
  );
  expect(command.change).toMatchObject({ kind: "game-session", minutes: 45 });
});
