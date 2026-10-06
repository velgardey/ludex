import { ZodError, z } from "zod";
import type { Repository } from "./store/repository.ts";
import { AuthService } from "./auth/principal.ts";
import type { AuthOptions } from "./auth/principal.ts";
import { LudexService } from "./service.ts";
import { ApiError } from "./errors.ts";
import { preview } from "./catalog/seed.ts";
import type { Viewer } from "../../../packages/domain/src/types.ts";
import { id } from "../../../packages/contracts/src/index.ts";
export type ApplicationOptions = { auth: AuthOptions; corsOrigins: string[] };
export async function createApplication(
  repo: Repository,
  options: ApplicationOptions,
) {
  const service = new LudexService(repo);
  await service.initialize();
  const auth = new AuthService(repo, options.auth);
  const rates = new Map<string, { count: number; reset: number }>();
  const checkRate = (key: string, max: number) => {
    const now = Date.now();
    let r = rates.get(key);
    if (!r || r.reset <= now) {
      r = { count: 0, reset: now + 60000 };
      rates.set(key, r);
    }
    if (++r.count > max)
      throw new ApiError(
        429,
        "rate-limited",
        "Please wait before trying again.",
        Math.ceil((r.reset - now) / 1000),
      );
    if (rates.size > 10000)
      for (const [k, v] of rates) if (v.reset < now) rates.delete(k);
  };
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    try {
      const origin = request.headers.get("origin");
      if (origin) {
        if (!options.corsOrigins.includes(origin))
          throw new ApiError(403, "origin-not-allowed");
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      }
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api/, "");
      const token =
        request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
      const method = request.method;
      let body: unknown = {};
      if (method === "POST") {
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > 65536) throw new ApiError(413, "request-too-large");
        const text = await request.text();
        if (Buffer.byteLength(text) > 65536)
          throw new ApiError(413, "request-too-large");
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          throw new ApiError(400, "invalid-json");
        }
      }
      const result = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value ?? {}), { status, headers });
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
      if (path === "/health" && method === "GET")
        return result({
          status: "ready",
          authMode: options.auth.mode,
          cloudVerified: false,
        });
      if (path === "/preview" && method === "GET") return result(preview());
      if (
        (path === "/auth/signup" || path === "/auth/login") &&
        method === "POST"
      ) {
        checkRate(`auth:${ip}`, 20);
        return result(
          path === "/auth/signup"
            ? await auth.signup(body)
            : await auth.login(body),
        );
      }
      const anonymousAllowed =
        method === "GET" &&
        [
          "/showcase",
          "/activity",
          "/collection",
          "/collections",
          "/social/replies",
        ].includes(path);
      const principal = token
        ? await auth.verifyBearer(token)
        : anonymousAllowed
          ? null
          : await auth.verifyBearer("");
      const viewer: Viewer = {
        userId: principal?.userId ?? null,
        policyRevision: await service.policyRevision(),
      };
      if (principal)
        checkRate(`user:${principal.userId}`, method === "POST" ? 120 : 300);
      const p = () => {
        if (!principal) throw new ApiError(401, "authentication-required");
        return principal;
      };
      const q = (key: string) => url.searchParams.get(key) ?? "";
      const target = () =>
        z.object({ targetId: id }).passthrough().parse(body).targetId;
      if (path === "/auth/me" && method === "GET")
        return result(await auth.me(p()));
      if (path === "/auth/logout" && method === "POST") {
        await auth.logout(token);
        return result({});
      }
      if (path === "/catalog/search" && method === "GET")
        return result(
          await service.searchCatalog({
            text: q("text"),
            media: q("media"),
            region: q("region"),
          }),
        );
      if (path === "/catalog/title" && method === "GET")
        return result(await service.getTitle(id.parse(q("id"))));
      if (path === "/library" && method === "GET")
        return result(await service.readLibrary(p()));
      if (path === "/progress" && method === "POST")
        return commandResult(
          await service.applyProgress(
            p(),
            body as Parameters<typeof service.applyProgress>[1],
          ),
          headers,
        );
      if (path === "/library/edit" && method === "POST")
        return commandResult(
          await service.editLibrary(
            p(),
            body as Parameters<typeof service.editLibrary>[1],
          ),
          headers,
        );
      if (path === "/progress/correct" && method === "POST")
        return commandResult(
          await service.correctProgress(
            p(),
            body as Parameters<typeof service.correctProgress>[1],
          ),
          headers,
        );
      if (path === "/feed" && method === "GET") {
        const query = z
          .object({
            filter: z
              .enum(["following", "friends", "circle"])
              .default("following"),
            limit: z.coerce.number().int().min(1).max(50).default(20),
            media: z.enum(["movie", "show", "game"]).optional(),
            cursor: z.string().max(2000).optional(),
            circleId: id.optional(),
          })
          .parse(Object.fromEntries(url.searchParams));
        return result(await service.readFeed(viewer, query));
      }
      if (path === "/activity" && method === "GET")
        return result(await service.readActivity(viewer, id.parse(q("id"))));
      if (path === "/social/users" && method === "GET")
        return result(await service.discoverUsers(p(), q("text")));
      if (path === "/social/status" && method === "GET")
        return result(await service.socialStatus(p(), id.parse(q("userId"))));
      if (path === "/social/follow" && method === "POST") {
        const input = z
          .object({ targetId: id, following: z.boolean().default(true) })
          .strict()
          .parse(body);
        await service.follow(p(), input.targetId, input.following);
        return result({});
      }
      if (path === "/social/friendship" && method === "POST") {
        const input = z
          .object({
            targetId: id,
            action: z.enum(["request", "accept", "remove"]),
          })
          .strict()
          .parse(body);
        await service.setFriendship(p(), input.targetId, input.action);
        return result({});
      }
      if (path === "/showcase" && method === "GET")
        return result(
          await service.readShowcase(viewer, id.parse(q("userId"))),
        );
      if (path === "/showcase" && method === "POST")
        return commandResult(
          await service.saveShowcase(
            p(),
            body as Parameters<typeof service.saveShowcase>[1],
          ),
          headers,
        );
      if (path === "/collection" && method === "POST")
        return commandResult(
          await service.saveCollection(
            p(),
            body as Parameters<typeof service.saveCollection>[1],
          ),
          headers,
        );
      if (path === "/collection" && method === "GET")
        return result(await service.readCollection(viewer, id.parse(q("id"))));
      if (path === "/collections" && method === "GET")
        return result(
          await service.readCollections(viewer, q("userId") || undefined),
        );
      if (path === "/social/review/drafts" && method === "GET")
        return result(await service.readReviewDrafts(p()));
      if (path === "/social/review/draft" && method === "POST") {
        const input = z
          .object({
            id,
            titleId: id,
            text: z.string().max(10000),
            version: z.number().int().min(0),
            rating: z.number().int().min(1).max(10).optional(),
          })
          .strict()
          .parse(body);
        return result(await service.saveReviewDraft(p(), input));
      }
      if (path === "/social/review/publish" && method === "POST")
        return result(await service.publishReview(p(), body));
      if (path === "/social/reply" && method === "POST")
        return result(await service.addReply(p(), body));
      if (path === "/social/replies" && method === "GET")
        return result(
          await service.readReplies(viewer, id.parse(q("activityId"))),
        );
      if (path === "/social/react" && method === "POST") {
        const input = z
          .object({ activityId: id, liked: z.boolean() })
          .strict()
          .parse(body);
        await service.react(p(), input.activityId, input.liked);
        return result({});
      }
      if (path === "/social/block" && method === "POST") {
        await service.blockUser(p(), target());
        return result({});
      }
      if (path === "/social/report" && method === "POST") {
        const input = z
          .object({
            targetId: id,
            reason: z.enum(["spam", "harassment", "spoiler", "other"]),
            note: z.string().max(2000).optional(),
          })
          .strict()
          .parse(body);
        return result(await service.reportContent(p(), input));
      }
      if (path === "/moderation" && method === "GET")
        return result(await service.moderation(p()));
      if (path === "/moderation" && method === "POST") {
        const input = z
          .object({
            targetId: id,
            action: z.enum(["remove", "suspend"]),
            reason: z.string().min(1).max(500),
          })
          .strict()
          .parse(body);
        await service.moderate(p(), input);
        return result({});
      }
      if (path === "/social/circles" && method === "GET")
        return result(await service.readCircles(p()));
      if (path === "/social/circles" && method === "POST") {
        const input = z
          .object({
            id,
            name: z.string().trim().min(1).max(80),
            memberIds: z.array(id).max(8),
          })
          .strict()
          .parse(body);
        return result(await service.saveCircle(p(), input));
      }
      if (path === "/social/review/edit" && method === "POST") {
        const input = z
          .object({
            activityId: id,
            baseVersion: z.number().int().min(1),
            text: z.string().max(10000).optional(),
            retract: z.boolean(),
          })
          .strict()
          .parse(body);
        return result(await service.editReview(p(), input));
      }
      if (path === "/social/reply/edit" && method === "POST") {
        const input = z
          .object({
            replyId: id,
            baseVersion: z.number().int().min(1),
            text: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(body);
        return result(await service.editReply(p(), input));
      }
      if (path === "/account/settings" && method === "GET")
        return result(await service.getSettings(p()));
      if (path === "/account/settings" && method === "POST") {
        const input = z
          .object({
            region: z
              .string()
              .regex(/^[A-Z]{2}$/)
              .optional(),
            timeZone: z
              .string()
              .max(100)
              .refine((v) => {
                try {
                  new Intl.DateTimeFormat("en", { timeZone: v });
                  return true;
                } catch {
                  return false;
                }
              })
              .optional(),
            defaultAudience: z
              .enum(["private", "public", "friends"])
              .optional(),
            lowData: z.boolean().optional(),
            reducedMotion: z.boolean().optional(),
            haptics: z.boolean().optional(),
            notificationPreferences: z
              .record(z.string(), z.boolean())
              .optional(),
          })
          .strict()
          .parse(body);
        return result(await service.saveSettings(p(), input));
      }
      if (path === "/account/export" && method === "POST") {
        const exported = await service.exportAccount(p());
        return result({
          ...exported,
          downloadUrl: `${url.origin}${exported.downloadUrl}`,
        });
      }
      if (path === "/account/download" && method === "GET") {
        headers["Content-Disposition"] =
          'attachment; filename="ludex-export.json"';
        return result(await service.downloadExport(p(), id.parse(q("id"))));
      }
      if (path === "/account/delete" && method === "POST") {
        const deletion = await service.requestDeletion(p());
        setTimeout(() => {
          void service.processDeletion(deletion.jobId).catch(() => {});
        }, 0);
        return result(deletion);
      }
      if (
        [
          "/plans",
          "/companion/ask",
          "/connections",
          "/import/preview",
        ].includes(path)
      )
        throw new ApiError(
          503,
          "stage-not-available",
          "This feature becomes available in a later stage.",
        );
      throw new ApiError(404, "route-not-found");
    } catch (error) {
      const e =
        error instanceof ApiError
          ? error
          : error instanceof ZodError
            ? new ApiError(
                400,
                "invalid-input",
                error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; "),
              )
            : new ApiError(
                500,
                "internal-error",
                "The request could not be completed.",
              );
      if (e.retryAfterSeconds)
        headers["Retry-After"] = String(e.retryAfterSeconds);
      return new Response(
        JSON.stringify({
          code: e.code,
          message: e.message,
          ...(e.retryAfterSeconds
            ? { retryAfterSeconds: e.retryAfterSeconds }
            : {}),
        }),
        { status: e.status, headers },
      );
    }
  };
}
function commandResult(
  value: { status: string },
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(value), {
    status:
      value.status === "conflict"
        ? 409
        : value.status === "rejected"
          ? 400
          : 200,
    headers,
  });
}
