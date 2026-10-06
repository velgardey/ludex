import { offerRefresh } from "../src/features/feed/model";

it("a foreground refresh immediately removes revoked detail while offering additive arrivals", () => {
  const current = {
    items: [
      { id: "private", note: "restricted words" },
      { id: "kept", note: "old" },
    ],
    etag: "one",
  };
  const incoming = {
    items: [
      { id: "new", note: "new" },
      { id: "kept", note: "redacted" },
    ],
    etag: "two",
  };
  const result = offerRefresh(current, incoming);
  expect(result.displayed.items).toEqual([{ id: "kept", note: "redacted" }]);
  expect(JSON.stringify(result.displayed)).not.toContain("restricted words");
  expect(result.offered?.items[0].id).toBe("new");
});
