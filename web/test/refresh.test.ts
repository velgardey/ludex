import { expect, it } from "vitest";
import { readJournalPanels } from "../refresh";

it("a catalog outage preserves successful library and social panel responses", async () => {
  const panels = await readJournalPanels({
    catalog: async () => {
      throw new Error("catalog unavailable");
    },
    feed: async () => ({ items: [{ id: "activity" }] }),
    library: async () => [{ titleId: "movie" }],
    people: async () => [],
    showcase: async () => ({ shelves: [] }),
  });
  expect(panels.library).toEqual([{ titleId: "movie" }]);
  expect(panels.feed).toEqual({ items: [{ id: "activity" }] });
  expect(panels.catalog).toBeUndefined();
  expect(panels.failures).toEqual(["catalog"]);
});
