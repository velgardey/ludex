import { createHash, randomUUID } from "node:crypto";
import type { Repository, Operation } from "../store/repository.ts";
import { stored } from "../store/repository.ts";
import type { User } from "../../../../packages/domain/src/types.ts";
import { publicUser } from "./principal.ts";
import { ApiError } from "../errors.ts";
/** Operator-only provisioning. No public endpoint accepts OIDC bindings or roles. */
export async function provisionInvitedSubject(
  repo: Repository,
  input: {
    issuer: string;
    subject: string;
    displayName: string;
    email?: string;
  },
  maxAccounts = 100,
): Promise<User> {
  if (
    !input.issuer.startsWith("https://") ||
    !input.subject ||
    !input.displayName.trim()
  )
    throw new ApiError(400, "invalid-subject");
  const id = `oidc:${createHash("sha256").update(`${input.issuer}|${input.subject}`).digest("hex")}`;
  const existing = await repo.read("social", id);
  if (existing) {
    const account = await repo.read(
      "social",
      `account:${(existing.body as { userId: string }).userId}`,
    );
    return (account!.body as { user: User }).user;
  }
  const quota = await repo.read("social", "invitation-quota");
  const count = Number(
    (quota?.body as { count: number } | undefined)?.count ??
      (await repo.list("social", "account:")).length,
  );
  if (count >= maxAccounts) throw new ApiError(403, "cohort-full");
  const user: User = {
    id: randomUUID(),
    displayName: input.displayName.trim(),
    email: input.email,
    roles: ["user"],
  };
  const ops: Operation[] = [
    { kind: "create", value: stored("social", id, { userId: user.id }) },
    {
      kind: "create",
      value: stored("social", `account:${user.id}`, {
        user,
        disabled: false,
        subject: input.subject,
        createdAt: new Date().toISOString(),
      }),
    },
    {
      kind: "create",
      value: stored("social", `profile:${user.id}`, publicUser(user)),
    },
    quota
      ? {
          kind: "replace",
          value: stored("social", "invitation-quota", { count: count + 1 }),
          expectedEtag: quota.etag,
        }
      : {
          kind: "create",
          value: stored("social", "invitation-quota", { count: count + 1 }),
        },
  ];
  if ((await repo.transact("social", ops)) === "conflict")
    throw new ApiError(409, "invitation-conflict");
  return user;
}
