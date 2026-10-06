import test from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/store/sqlite.ts";
import { AuthService } from "../src/auth/principal.ts";
test("invited signup makes real empty account and hashed credentials; session persists and revoked token denied", async () => {
  const repo = new SqliteRepository(":memory:");
  const auth = new AuthService(repo, {
    mode: "local",
    inviteCode: "test-invite",
  });
  await assert.rejects(
    auth.signup({
      inviteCode: "bad",
      email: "a@example.test",
      password: "long-enough-secret",
      displayName: "Alice",
    }),
  );
  const session = await auth.signup({
    inviteCode: "test-invite",
    email: "a@example.test",
    password: "long-enough-secret",
    displayName: "Alice",
  });
  assert.equal(
    (await auth.verifyBearer(session.token)).userId,
    session.user.id,
  );
  assert.ok(
    !JSON.stringify(await repo.list("social")).includes("long-enough-secret"),
  );
  const auth2 = new AuthService(repo, {
    mode: "local",
    inviteCode: "test-invite",
  });
  assert.equal(
    (await auth2.verifyBearer(session.token)).userId,
    session.user.id,
  );
  await assert.rejects(
    auth.login({ email: "a@example.test", password: "wrong" }),
  );
  await auth.logout(session.token);
  await assert.rejects(auth.verifyBearer(session.token));
  repo.close();
});
test("OIDC rejects unsigned and misconfigured tokens without accepting local passwords", async () => {
  const auth = new AuthService(new SqliteRepository(":memory:"), {
    mode: "oidc",
    inviteCode: "ignored",
  });
  await assert.rejects(
    auth.signup({
      inviteCode: "ignored",
      email: "a@example.test",
      password: "long-enough-secret",
      displayName: "Alice",
    }),
  );
  await assert.rejects(
    auth.verifyBearer("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0."),
  );
});
test("OIDC verifies RS256 issuer audience expiry and invited subject binding using a local JWKS", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { createServer } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const { stored } = await import("../src/store/repository.ts");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const issuer = "https://identity.example.test/tenant/v2.0";
  const repo = new SqliteRepository(":memory:");
  const auth = new AuthService(repo, {
    mode: "oidc",
    issuer,
    audience: "ludex-test-api",
    jwksUrl: `http://127.0.0.1:${port}/jwks`,
  });
  const token = async (
    iss = issuer,
    aud = "ludex-test-api",
    exp = "5m",
    sub = "invited-subject",
  ) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  await assert.rejects(auth.verifyBearer(await token()), /invitation-required/);
  await repo.transact("social", [
    {
      kind: "create",
      value: stored("social", "account:oidc-user", {
        user: { id: "oidc-user", displayName: "OIDC Alice", roles: ["user"] },
        disabled: false,
      }),
    },
    {
      kind: "create",
      value: stored(
        "social",
        `oidc:${createHash("sha256").update(`${issuer}|invited-subject`).digest("hex")}`,
        { userId: "oidc-user" },
      ),
    },
  ]);
  assert.equal((await auth.verifyBearer(await token())).userId, "oidc-user");
  await assert.rejects(auth.verifyBearer(await token("https://wrong.test")));
  await assert.rejects(
    auth.verifyBearer(await token(issuer, "wrong-audience")),
  );
  await assert.rejects(
    auth.verifyBearer(await token(issuer, "ludex-test-api", "-1s")),
  );
  await assert.rejects(
    auth.verifyBearer(await token(issuer, "ludex-test-api", "5m", "uninvited")),
  );
  await new Promise<void>((r) => server.close(() => r()));
  repo.close();
});
