import test from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/store/sqlite.ts";
import { provisionInvitedSubject } from "../src/auth/invitations.ts";
test("OIDC invitation binding reserves cohort slot once and never accepts client roles", async () => {
  const repo = new SqliteRepository(":memory:");
  const first = await provisionInvitedSubject(
    repo,
    {
      issuer: "https://oidc.example.test",
      subject: "one",
      displayName: "Alice",
      email: "a@example.test",
    },
    1,
  );
  assert.deepEqual(
    await provisionInvitedSubject(
      repo,
      {
        issuer: "https://oidc.example.test",
        subject: "one",
        displayName: "Alice",
        email: "a@example.test",
      },
      1,
    ),
    first,
  );
  await assert.rejects(
    provisionInvitedSubject(
      repo,
      {
        issuer: "https://oidc.example.test",
        subject: "two",
        displayName: "Bob",
      },
      1,
    ),
    /cohort-full/,
  );
  assert.deepEqual(first.roles, ["user"]);
  repo.close();
});
