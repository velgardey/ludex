import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type {
  Principal,
  Session,
  User,
} from "../../../../packages/domain/src/types.ts";
import type { Repository, Operation } from "../store/repository.ts";
import { stored } from "../store/repository.ts";
import { ApiError } from "../errors.ts";
import {
  signupSchema,
  loginSchema,
} from "../../../../packages/contracts/src/index.ts";
export type AuthOptions = {
  mode: "local" | "oidc";
  inviteCode?: string;
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  moderatorEmails?: string[];
  maxAccounts?: number;
};
type Account = {
  user: User;
  passwordHash?: string;
  disabled: boolean;
  createdAt: string;
  subject?: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class AuthService {
  private repo: Repository;
  private options: AuthOptions;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(repo: Repository, options: AuthOptions) {
    this.repo = repo;
    this.options = options;
    if (options.jwksUrl)
      this.jwks = createRemoteJWKSet(new URL(options.jwksUrl));
  }
  async signup(raw: unknown): Promise<Session> {
    if (this.options.mode !== "local")
      throw new ApiError(
        503,
        "oidc-required",
        "Use the configured identity provider.",
      );
    const input = signupSchema.parse(raw);
    if (
      !this.options.inviteCode ||
      !timingSafeEqual(
        hashBuffer(input.inviteCode),
        hashBuffer(this.options.inviteCode),
      )
    )
      throw new ApiError(
        403,
        "invitation-required",
        "A valid invitation is required.",
      );
    const email = input.email.toLowerCase();
    const emailKey = `email:${hash(email)}`;
    if (await this.repo.read("social", emailKey))
      throw new ApiError(409, "email-in-use");
    const users = await this.repo.list("social", "account:");
    if (users.length >= (this.options.maxAccounts ?? 100))
      throw new ApiError(403, "cohort-full");
    const user: User = {
      id: randomUUID(),
      displayName: input.displayName,
      email,
      roles: this.options.moderatorEmails?.includes(email)
        ? ["user", "moderator"]
        : ["user"],
    };
    const salt = randomBytes(16).toString("hex");
    const account: Account = {
      user,
      passwordHash: `${salt}:${scryptSync(input.password, salt, 64).toString("hex")}`,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    const quota = await this.repo.read("social", "invitation-quota");
    const count = Number(
      (quota?.body as { count?: number } | undefined)?.count ?? users.length,
    );
    if (count >= (this.options.maxAccounts ?? 100))
      throw new ApiError(403, "cohort-full");
    const ops: Operation[] = [
      {
        kind: "create",
        value: stored("social", `account:${user.id}`, account),
      },
      {
        kind: "create",
        value: stored("social", emailKey, { userId: user.id }),
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
    if ((await this.repo.transact("social", ops)) === "conflict")
      throw new ApiError(409, "signup-conflict", "Please try again.");
    return this.issue(user);
  }
  async login(raw: unknown): Promise<Session> {
    if (this.options.mode !== "local") throw new ApiError(503, "oidc-required");
    const input = loginSchema.parse(raw);
    const email = await this.repo.read(
      "social",
      `email:${hash(input.email.toLowerCase())}`,
    );
    const account = email
      ? await this.repo.read(
          "social",
          `account:${(email.body as { userId: string }).userId}`,
        )
      : null;
    const body = account?.body as Account | undefined;
    const [salt, expected] = (
      body?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`
    ).split(":");
    const actual = scryptSync(input.password, salt, 64);
    if (
      !body ||
      body.disabled ||
      !timingSafeEqual(actual, Buffer.from(expected, "hex"))
    )
      throw new ApiError(
        401,
        "invalid-credentials",
        "Email or password is incorrect.",
      );
    return this.issue(body.user);
  }
  private async issue(user: User): Promise<Session> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await this.repo.transact("social", [
      {
        kind: "create",
        value: stored("social", `session:${hash(token)}`, {
          userId: user.id,
          expiresAt,
        }),
      },
    ]);
    return { token, expiresAt, user };
  }
  async verifyBearer(token: string): Promise<Principal> {
    if (!token) throw new ApiError(401, "authentication-required");
    let userId: string;
    if (this.options.mode === "local") {
      const session = await this.repo.read("social", `session:${hash(token)}`);
      const body = session?.body as
        { userId: string; expiresAt: string } | undefined;
      if (!body || Date.parse(body.expiresAt) <= Date.now())
        throw new ApiError(401, "session-expired");
      userId = body.userId;
    } else {
      if (!this.jwks || !this.options.issuer || !this.options.audience)
        throw new ApiError(503, "identity-not-configured");
      try {
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: this.options.issuer,
          audience: this.options.audience,
          algorithms: ["RS256"],
          requiredClaims: ["sub", "exp", "iat"],
        });
        const binding = await this.repo.read(
          "social",
          `oidc:${hash(`${payload.iss}|${payload.sub}`)}`,
        );
        if (!binding) throw new ApiError(403, "invitation-required");
        userId = (binding.body as { userId: string }).userId;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(401, "invalid-token");
      }
    }
    const account = await this.repo.read("social", `account:${userId}`);
    const body = account?.body as Account | undefined;
    if (
      !body ||
      body.disabled ||
      (
        (await this.repo.read(`user:${userId}`, "write-guard"))?.body as
          { closed?: boolean } | undefined
      )?.closed
    )
      throw new ApiError(401, "account-disabled");
    return { userId, roles: body.user.roles };
  }
  async me(principal: Principal): Promise<User> {
    const account = await this.repo.read(
      "social",
      `account:${principal.userId}`,
    );
    return (account?.body as Account).user;
  }
  async logout(token: string) {
    if (this.options.mode === "local") {
      const session = await this.repo.read("social", `session:${hash(token)}`);
      if (session)
        await this.repo.transact("social", [
          { kind: "delete", id: session.id, expectedEtag: session.etag },
        ]);
    }
  }
}
function hashBuffer(value: string) {
  return createHash("sha256").update(value).digest();
}
export function publicUser(user: User): User {
  return {
    id: user.id,
    displayName: user.displayName,
    roles: ["user"],
    ...(user.sample ? { sample: true } : {}),
    ...(user.bio ? { bio: user.bio } : {}),
  };
}
