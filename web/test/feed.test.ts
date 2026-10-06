import { it, expect } from "vitest";
import { refreshVisibleFeed } from "../feed";
it("refresh removes revoked records and replaces newly concealed bodies before offering arrivals", () => {
  const old = [
    { id: "a", note: "secret", detailHidden: false },
    { id: "b", note: "revoked" },
  ];
  const incoming = [{ id: "new" }, { id: "a", detailHidden: true }];
  expect(refreshVisibleFeed(old, incoming)).toEqual([
    { id: "a", detailHidden: true },
  ]);
});
it("existing order stays stable when a new arrival is offered", () => {
  expect(
    refreshVisibleFeed(
      [{ id: "a" }, { id: "b" }],
      [{ id: "new" }, { id: "b" }, { id: "a" }],
    ).map((x) => x.id),
  ).toEqual(["a", "b"]);
});
