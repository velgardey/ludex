import test from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/store/sqlite.ts";
import { createApplication } from "../src/http.ts";
test("HTTP authenticates principals, enforces CORS/body validation and starts with empty real account", async () => {
  const app = await createApplication(new SqliteRepository(":memory:"), {
    auth: { mode: "local", inviteCode: "invite" },
    corsOrigins: ["http://localhost:3000"],
  });
  const call = (
    path: string,
    body?: unknown,
    token?: string,
    extra: Record<string, string> = {},
  ) =>
    app(
      new Request(`http://localhost:4000/api${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  assert.equal((await call("/library")).status, 401);
  assert.equal(
    (
      await call("/preview", undefined, undefined, {
        origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const signup = await call("/auth/signup", {
    inviteCode: "invite",
    email: "alice@example.test",
    password: "an-example-long-password",
    displayName: "Alice",
  });
  assert.equal(signup.status, 200);
  const session = await signup.json();
  assert.deepEqual(
    await (await call("/library", undefined, session.token)).json(),
    [],
  );
  assert.equal(
    (
      await call(
        "/progress",
        { titleId: "bad", userId: "another-user" },
        session.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call("/moderation", undefined, session.token)).status,
    403,
  );
  const deleted = await call("/account/delete", {}, session.token);
  assert.equal(deleted.status, 200);
  assert.equal((await call("/library", undefined, session.token)).status, 401);
});
