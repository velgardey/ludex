import { readGoogleHandoff, base64url } from "../src/auth/google";
test("Google handoff rejects a different state or callback origin", () => {
  expect(() =>
    readGoogleHandoff("ludex://auth?code=abc&state=wrong", "expected"),
  ).toThrow();
  expect(() =>
    readGoogleHandoff(
      "https://evil.test/auth?code=abc&state=expected",
      "expected",
    ),
  ).toThrow();
  expect(
    readGoogleHandoff("ludex://auth?code=abc&state=expected", "expected"),
  ).toBe("abc");
});
test("PKCE digest uses URL safe base64 without padding", () => {
  expect(base64url("+/a==")).toBe("-_a");
});
