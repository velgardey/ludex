import {
  offerRefresh,
  publicShelves,
  moveShelf,
} from "../src/features/feed/model";
it("refresh holds new items separately without moving the currently displayed item", () => {
  const current = { items: [{ id: "old" }], etag: "one" };
  const incoming = { items: [{ id: "new" }, { id: "old" }], etag: "two" };
  const result = offerRefresh(current, incoming);
  expect(result.displayed.items[0].id).toBe("old");
  expect(result.offered).toEqual(incoming);
});
it("public viewer mode omits private and friends shelves", () => {
  expect(
    publicShelves([
      { id: "private", audience: { kind: "private" } },
      { id: "friends", audience: { kind: "friends" } },
      { id: "public", audience: { kind: "public" } },
    ]).map((s) => s.id),
  ).toEqual(["public"]);
});
it("shelf button reorder preserves each shelf and clamps boundaries", () => {
  expect(moveShelf(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveShelf(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
});
