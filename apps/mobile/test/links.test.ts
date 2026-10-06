import { resolveIncomingUrl } from "../src/links/resolve";
it("resolves actual companion query URLs without treating an ID as permission", () => {
  expect(
    resolveIncomingUrl(
      "https://ludex.example/title/?id=film",
      "https://ludex.example",
    ),
  ).toEqual({ kind: "title", id: "film" });
  expect(
    resolveIncomingUrl(
      "https://ludex.example/profile/?u=alice",
      "https://ludex.example",
    ),
  ).toEqual({ kind: "profile", id: "alice" });
});
it("rejects an untrusted origin, duplicate IDs and unknown paths", () => {
  expect(
    resolveIncomingUrl(
      "https://evil.example/title/?id=film",
      "https://ludex.example",
    ),
  ).toBeNull();
  expect(
    resolveIncomingUrl(
      "https://ludex.example/title/?id=film&id=private",
      "https://ludex.example",
    ),
  ).toBeNull();
  expect(
    resolveIncomingUrl(
      "https://ludex.example/admin/?id=film",
      "https://ludex.example",
    ),
  ).toBeNull();
});
