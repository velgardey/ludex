import {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type {
  Activity,
  ActivityPage,
  Audience,
  CatalogHit,
  Collection,
  CommandResult,
  CorrectionCommand,
  FeedQuery,
  LibraryEditCommand,
  LibraryItem,
  Principal,
  ProviderObservation,
  ProgressChange,
  ProgressCommand,
  Reply,
  Showcase,
  SpoilerScope,
  User,
  Viewer,
} from "../../../packages/domain/src/types.ts";
import {
  emptyLibrary,
  reduceProgress,
  spoilerIds,
} from "../../../packages/domain/src/progress.ts";
import { canReveal } from "../../../packages/domain/src/spoilers.ts";
import {
  progressSchema,
  libraryEditSchema,
  correctionSchema,
  showcaseSchema,
  collectionSchema,
  reviewSchema,
  replySchema,
} from "../../../packages/contracts/src/index.ts";
import type { Operation, Repository, Stored } from "./store/repository.ts";
import { stored } from "./store/repository.ts";
import { ApiError, requireValue } from "./errors.ts";
import { seedCatalog, searchCatalog } from "./catalog/service.ts";
import { sampleUsers, sampleShowcase } from "./catalog/seed.ts";
import { publicUser } from "./auth/principal.ts";
type Event = {
  id: string;
  userId: string;
  titleId: string;
  active: boolean;
  sequence: number;
  command: ProgressCommand;
};
type SocialActivity = {
  id: string;
  authorId: string;
  titleId: string;
  caption: string;
  note?: string;
  rating?: number;
  audience: Audience;
  spoiler: SpoilerScope;
  occurredAt: ProgressCommand["occurredAt"];
  publishedAt: string;
  kind: "progress" | "review";
  eventId?: string;
  draftId?: string;
  retracted?: boolean;
};
type Receipt = { hash: string; result: CommandResult };
const digest = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const scope = (principal: Principal) => `user:${principal.userId}`;
const pair = (a: string, b: string) => [a, b].sort().join(":");
export class LudexService {
  readonly repo: Repository;
  private cursorSecret = "";
  constructor(repo: Repository) {
    this.repo = repo;
  }
  async initialize() {
    await seedCatalog(this.repo);
    let secret = await this.repo.read("social", "cursor-key");
    if (!secret) {
      await this.repo.transact("social", [
        {
          kind: "create",
          value: stored("social", "cursor-key", {
            key: randomBytes(32).toString("hex"),
          }),
        },
      ]);
      secret = await this.repo.read("social", "cursor-key");
    }
    this.cursorSecret = (secret!.body as { key: string }).key;
  }
  async searchCatalog(query: {
    text?: string;
    media?: string;
    region?: string;
  }) {
    return searchCatalog(this.repo, query);
  }
  async getTitle(id: string) {
    return requireValue(
      (await this.repo.read("catalog", id))?.body as CatalogHit | undefined,
    );
  }
  async readLibrary(p: Principal): Promise<LibraryItem[]> {
    return (await this.repo.list(scope(p), "library:"))
      .map((r) => r.body as LibraryItem)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  private async receipt(
    p: Principal,
    commandId: string,
    input: unknown,
  ): Promise<CommandResult | null> {
    const old =
      (await this.repo.read(scope(p), `command:${commandId}`)) ??
      (await this.repo.read("social", `receipt:${p.userId}:${commandId}`));
    if (!old) return null;
    const r = old.body as Receipt;
    return r.hash === digest(input)
      ? r.result
      : { status: "rejected", commandId, code: "command-payload-mismatch" };
  }
  private receiptOp(
    p: Principal,
    commandId: string,
    input: unknown,
    result: CommandResult,
  ): Operation {
    return {
      kind: "create",
      value: stored(scope(p), `command:${commandId}`, {
        hash: digest(input),
        result,
      }),
    };
  }
  private updateOp(old: Stored | null, value: Stored): Operation {
    return old
      ? { kind: "replace", value, expectedEtag: old.etag }
      : { kind: "create", value };
  }
  private validateChange(title: CatalogHit, change: ProgressChange) {
    if (title.id !== change.titleId) throw new ApiError(400, "title-mismatch");
    const types: Record<string, string> = {
      "movie-viewed": "movie",
      "episode-watched": "show",
      "episode-skipped": "show",
      "game-session": "game",
      milestone: "game",
      "story-completed": "game",
      achievement: "game",
    };
    if (types[change.kind] && types[change.kind] !== title.media)
      throw new ApiError(400, "media-mismatch");
    if ("medium" in change && change.medium !== title.media)
      throw new ApiError(400, "media-mismatch");
    if (
      "episodeId" in change &&
      !title.episodes?.some((e) => e.id === change.episodeId)
    )
      throw new ApiError(400, "unknown-episode");
  }
  private validateSpoiler(title: CatalogHit, spoiler: SpoilerScope) {
    if (spoiler.kind === "none") return;
    const id =
      spoiler.kind === "episodes"
        ? spoiler.showId
        : spoiler.kind === "milestone"
          ? spoiler.gameId
          : spoiler.titleId;
    if (id !== title.id) throw new ApiError(400, "spoiler-title-mismatch");
    if (
      spoiler.kind === "episodes" &&
      (title.media !== "show" ||
        !spoiler.requiredEpisodeIds.length ||
        spoiler.requiredEpisodeIds.some(
          (id) => !title.episodes?.some((e) => e.id === id),
        ))
    )
      throw new ApiError(400, "invalid-spoiler-episodes");
    if (
      spoiler.kind === "milestone" &&
      (title.media !== "game" || !spoiler.requiredMilestoneIds.length)
    )
      throw new ApiError(400, "invalid-spoiler-milestones");
  }
  private async ownerTransact(p: Principal, operations: Operation[]) {
    if (!(await this.active(p.userId)))
      throw new ApiError(401, "account-disabled");
    const guard = await this.repo.read(scope(p), "write-guard");
    if ((guard?.body as { closed?: boolean } | undefined)?.closed)
      throw new ApiError(401, "account-disabled");
    const guardOp = this.updateOp(
      guard,
      stored(
        scope(p),
        "write-guard",
        { closed: false },
        (guard?.version ?? 0) + 1,
      ),
    );
    return this.repo.transact(scope(p), [guardOp, ...operations]);
  }
  private async socialWriteFor(p: Principal, ops: Operation[], policy = false) {
    const account = await this.repo.read("social", `account:${p.userId}`);
    if (!account || (account.body as { disabled: boolean }).disabled)
      throw new ApiError(401, "account-disabled");
    const guard = await this.repo.read(scope(p), "write-guard");
    if ((guard?.body as { closed?: boolean } | undefined)?.closed)
      throw new ApiError(401, "account-disabled");
    ops.push({
      kind: "replace",
      value: stored("social", account.id, account.body, account.version),
      expectedEtag: account.etag,
    });
    return this.socialWrite(ops, policy);
  }
  async applyProgress(
    p: Principal,
    raw: ProgressCommand,
  ): Promise<CommandResult> {
    const cmd = progressSchema.parse(raw) as ProgressCommand;
    const cached = await this.receipt(p, cmd.commandId, cmd);
    if (cached) return cached;
    const title = await this.getTitle(cmd.titleId);
    this.validateChange(title, cmd.change);
    this.validateSpoiler(title, cmd.spoiler);
    const s = scope(p);
    const old = await this.repo.read(s, `library:${cmd.titleId}`);
    const current = old?.body as LibraryItem | undefined;
    if ((current?.version ?? 0) !== cmd.baseVersion)
      return {
        status: "conflict",
        commandId: cmd.commandId,
        currentVersion: current?.version ?? 0,
      };
    const next = reduceProgress(
      current ?? emptyLibrary(cmd.titleId),
      cmd.change,
    );
    next.version = cmd.baseVersion + 1;
    next.updatedAt = new Date().toISOString();
    if (cmd.rating !== undefined) next.rating = cmd.rating;
    if (cmd.liked !== undefined) next.liked = cmd.liked;
    if (cmd.note !== undefined) next.note = cmd.note;
    const eventId = `event:${cmd.commandId}`;
    const event: Event = {
      id: eventId,
      userId: p.userId,
      titleId: cmd.titleId,
      active: true,
      sequence: next.version,
      command: cmd,
    };
    const result: CommandResult = {
      status: "accepted",
      commandId: cmd.commandId,
      version: next.version,
      eventId,
    };
    const ops: Operation[] = [
      { kind: "create", value: stored(s, eventId, event) },
      this.updateOp(
        old,
        stored(s, `library:${cmd.titleId}`, next, next.version),
      ),
      this.receiptOp(p, cmd.commandId, cmd, result),
    ];
    if (cmd.audience.kind !== "private")
      ops.push({
        kind: "create",
        value: stored(s, `publish:${cmd.commandId}`, { eventId, done: false }),
      });
    if ((await this.ownerTransact(p, ops)) === "conflict")
      return (
        (await this.receipt(p, cmd.commandId, cmd)) ?? {
          status: "conflict",
          commandId: cmd.commandId,
          currentVersion:
            (await this.repo.read(s, `library:${cmd.titleId}`))?.version ?? 0,
        }
      );
    await this.publishPending(p.userId, 20);
    return result;
  }
  async editLibrary(
    p: Principal,
    raw: LibraryEditCommand,
  ): Promise<CommandResult> {
    const cmd = libraryEditSchema.parse(raw) as LibraryEditCommand;
    const cached = await this.receipt(p, cmd.commandId, cmd);
    if (cached) return cached;
    const title = await this.getTitle(cmd.titleId);
    const old = await this.repo.read(scope(p), `library:${cmd.titleId}`);
    const current =
      (old?.body as LibraryItem | undefined) ?? emptyLibrary(cmd.titleId);
    if (current.version !== cmd.baseVersion)
      return {
        status: "conflict",
        commandId: cmd.commandId,
        currentVersion: current.version,
      };
    if (
      cmd.patch.state === "completed" &&
      title.media === "show" &&
      (!title.ended ||
        !current.runs.some((r) =>
          title.episodes?.every((e) => r.watchedEpisodeIds.includes(e.id)),
        ))
    )
      return {
        status: "rejected",
        commandId: cmd.commandId,
        code: "episode-evidence-required",
      };
    const next = {
      ...current,
      ...cmd.patch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    } as LibraryItem;
    if (cmd.patch.rating === null) delete next.rating;
    const eventId = `edit:${cmd.commandId}`;
    const result: CommandResult = {
      status: "accepted",
      commandId: cmd.commandId,
      version: next.version,
      eventId,
    };
    if (
      (await this.ownerTransact(p, [
        this.updateOp(
          old,
          stored(scope(p), `library:${cmd.titleId}`, next, next.version),
        ),
        {
          kind: "create",
          value: stored(scope(p), eventId, {
            titleId: cmd.titleId,
            sequence: next.version,
            patch: cmd.patch,
          }),
        },
        this.receiptOp(p, cmd.commandId, cmd, result),
      ])) === "conflict"
    )
      return (
        (await this.receipt(p, cmd.commandId, cmd)) ?? {
          status: "conflict",
          commandId: cmd.commandId,
          currentVersion: current.version,
        }
      );
    return result;
  }
  async correctProgress(
    p: Principal,
    raw: CorrectionCommand,
  ): Promise<CommandResult> {
    const cmd = correctionSchema.parse(raw) as CorrectionCommand;
    const cached = await this.receipt(p, cmd.commandId, cmd);
    if (cached) return cached;
    const eventDoc = requireValue(await this.repo.read(scope(p), cmd.eventId));
    const event = eventDoc.body as Event;
    if (!event.command) throw new ApiError(400, "not-progress-event");
    const old = requireValue(
      await this.repo.read(scope(p), `library:${event.titleId}`),
    );
    if (old.version !== cmd.baseVersion)
      return {
        status: "conflict",
        commandId: cmd.commandId,
        currentVersion: old.version,
      };
    if (cmd.replacement)
      this.validateChange(await this.getTitle(event.titleId), cmd.replacement);
    const corrected = {
      ...event,
      active: !cmd.retract,
      command: {
        ...event.command,
        ...(cmd.replacement ? { change: cmd.replacement } : {}),
      },
    };
    const records = [
      ...(await this.repo.list(scope(p), "event:")).map((d) => ({
        kind: "progress",
        sequence: (d.body as Event).sequence,
        body: d.id === event.id ? corrected : d.body,
      })),
      ...(await this.repo.list(scope(p), "edit:")).map((d) => ({
        kind: "edit",
        sequence: (d.body as { sequence: number }).sequence,
        body: d.body,
      })),
    ].sort((a, b) => a.sequence - b.sequence);
    let next = emptyLibrary(event.titleId);
    for (const record of records) {
      const body = record.body as Event & {
        patch?: LibraryEditCommand["patch"];
      };
      if (body.titleId !== event.titleId) continue;
      if (record.kind === "progress" && body.active) {
        next = reduceProgress(next, body.command.change);
        if (body.command.rating !== undefined)
          next.rating = body.command.rating;
        if (body.command.note !== undefined) next.note = body.command.note;
        if (body.command.liked !== undefined) next.liked = body.command.liked;
      }
      if (record.kind === "edit") {
        Object.assign(next, body.patch);
        if (body.patch?.rating === null) delete next.rating;
      }
    }
    next.version = old.version + 1;
    next.updatedAt = new Date().toISOString();
    const result: CommandResult = {
      status: "accepted",
      commandId: cmd.commandId,
      version: next.version,
      eventId: `correction:${cmd.commandId}`,
    };
    if (
      (await this.ownerTransact(p, [
        {
          kind: "replace",
          value: stored(scope(p), event.id, corrected, eventDoc.version + 1),
          expectedEtag: eventDoc.etag,
        },
        {
          kind: "replace",
          value: stored(scope(p), old.id, next, next.version),
          expectedEtag: old.etag,
        },
        { kind: "create", value: stored(scope(p), result.eventId, cmd) },
        this.receiptOp(p, cmd.commandId, cmd, result),
      ])) === "conflict"
    )
      return (
        (await this.receipt(p, cmd.commandId, cmd)) ?? {
          status: "conflict",
          commandId: cmd.commandId,
          currentVersion: old.version,
        }
      );
    const activity = await this.repo.read("social", `activity:${event.id}`);
    if (activity) {
      await this.repo.transact("social", [
        {
          kind: "replace",
          value: stored(
            "social",
            activity.id,
            {
              ...(activity.body as SocialActivity),
              retracted: cmd.retract,
              ...(cmd.replacement
                ? { caption: this.caption(cmd.replacement) }
                : {}),
            },
            activity.version + 1,
          ),
          expectedEtag: activity.etag,
        },
      ]);
    }
    return result;
  }
  private caption(change: ProgressChange) {
    switch (change.kind) {
      case "movie-viewed":
        return "Watched a film";
      case "episode-watched":
        return "Watched an episode";
      case "episode-skipped":
        return "Skipped an episode";
      case "game-session":
        return change.minutes
          ? `Played for ${change.minutes} minutes`
          : "Logged a game session";
      case "story-completed":
        return "Completed the story";
      case "milestone":
        return change.label;
      case "achievement":
        return "Earned an achievement";
      case "session-started":
        return change.medium === "game"
          ? "Started playing"
          : "Started watching";
      case "session-ended":
        return "Ended a session";
    }
  }
  async publishPending(userId: string, limit: number) {
    const s = `user:${userId}`;
    const account = await this.repo.read("social", `account:${userId}`);
    if (!account || (account.body as { disabled: boolean }).disabled) return 0;
    let count = 0;
    for (const outbox of (await this.repo.list(s, "publish:"))
      .filter((row) => !(row.body as { done: boolean }).done)
      .slice(0, limit)) {
      if ((outbox.body as { done: boolean }).done) continue;
      const eventDoc = await this.repo.read(
        s,
        (outbox.body as { eventId: string }).eventId,
      );
      const event = eventDoc?.body as Event | undefined;
      if (event?.active && event.command.audience.kind !== "private") {
        const cmd = event.command;
        const activity: SocialActivity = {
          id: event.id,
          authorId: userId,
          titleId: cmd.titleId,
          caption: this.caption(cmd.change),
          note: cmd.note,
          rating: cmd.rating,
          audience: cmd.audience,
          spoiler: cmd.spoiler,
          occurredAt: cmd.occurredAt,
          publishedAt: new Date().toISOString(),
          kind: "progress",
          eventId: event.id,
        };
        const existing = await this.repo.read("social", `activity:${event.id}`);
        if (!existing) {
          const result = await this.repo.transact("social", [
            {
              kind: "create",
              value: stored("social", `activity:${event.id}`, activity),
            },
            {
              kind: "create",
              value: stored("social", `notify:${event.id}`, {
                activityId: event.id,
                delivered: false,
              }),
            },
          ]);
          if (result === "conflict") continue;
        }
        count++;
      }
      await this.repo.transact(s, [
        {
          kind: "replace",
          value: stored(s, outbox.id, {
            ...(outbox.body as object),
            done: true,
          }),
          expectedEtag: outbox.etag,
        },
      ]);
    }
    return count;
  }
  private async blocked(a: string | null, b: string) {
    return (
      !!a &&
      !!(
        (await this.repo.read("social", `block:${a}:${b}`)) ||
        (await this.repo.read("social", `block:${b}:${a}`))
      )
    );
  }
  private async active(userId: string) {
    const user = await this.repo.read("social", `account:${userId}`);
    if (!user || (user.body as { disabled: boolean }).disabled) return false;
    return !(
      (await this.repo.read(`user:${userId}`, "write-guard"))?.body as
        { closed?: boolean } | undefined
    )?.closed;
  }
  private async visible(
    viewer: string | null,
    author: string,
    audience: Audience,
  ) {
    if (!(await this.active(author)) || (await this.blocked(viewer, author)))
      return false;
    if (viewer === author) return true;
    if (audience.kind === "public") return true;
    if (!viewer || audience.kind === "private") return false;
    if (audience.kind === "friends")
      return (
        (await this.repo.read("social", `friend:${pair(viewer, author)}`))
          ?.body !== undefined &&
        (
          (await this.repo.read("social", `friend:${pair(viewer, author)}`))
            ?.body as { status: string }
        ).status === "accepted"
      );
    const circle = await this.repo.read(
      "social",
      `circle:${audience.circleId}`,
    );
    const body = circle?.body as
      { ownerId: string; members: string[] } | undefined;
    return body?.ownerId === author && body.members.includes(viewer);
  }
  private async mayReveal(
    viewer: string | null,
    author: string,
    spoiler: SpoilerScope,
  ) {
    if (viewer === author || spoiler.kind === "none") return true;
    if (!viewer) return false;
    const titleId =
      spoiler.kind === "episodes"
        ? spoiler.showId
        : spoiler.kind === "milestone"
          ? spoiler.gameId
          : spoiler.titleId;
    const item = (await this.repo.read(`user:${viewer}`, `library:${titleId}`))
      ?.body as LibraryItem | undefined;
    return canReveal(
      spoilerIds(item),
      spoiler.kind === "episodes"
        ? spoiler.requiredEpisodeIds
        : spoiler.kind === "milestone"
          ? spoiler.requiredMilestoneIds
          : [titleId],
    );
  }
  private async activityVisible(
    viewer: string | null,
    activity: SocialActivity,
  ) {
    if (
      activity.retracted ||
      !(await this.visible(viewer, activity.authorId, activity.audience))
    )
      return false;
    if (activity.eventId) {
      const event = await this.repo.read(
        `user:${activity.authorId}`,
        activity.eventId,
      );
      if (!(event?.body as Event | undefined)?.active) return false;
    }
    return true;
  }
  private async project(
    viewer: string | null,
    a: SocialActivity,
  ): Promise<Activity> {
    const profile = requireValue(
      (await this.repo.read("social", `profile:${a.authorId}`))?.body as
        User | undefined,
    );
    const hidden = !(await this.mayReveal(viewer, a.authorId, a.spoiler));
    let title = await this.getTitle(a.titleId);
    if (hidden && a.spoiler.kind === "hidden")
      title = {
        id: "hidden",
        media: title.media,
        title: "Hidden title",
        providerIds: {},
      };
    const reactions = await this.repo.list("social", `reaction:${a.id}:`);
    const replies = await this.repo.list("social", `reply:${a.id}:`);
    return {
      id: a.id,
      authorId: a.authorId,
      author: publicUser(profile),
      titleId: hidden && a.spoiler.kind === "hidden" ? "hidden" : a.titleId,
      title,
      caption: hidden ? "Shared progress" : a.caption,
      ...(!hidden && a.note !== undefined ? { note: a.note } : {}),
      ...(!hidden && a.rating !== undefined ? { rating: a.rating } : {}),
      detailHidden: hidden,
      occurredAt: a.occurredAt,
      publishedAt: a.publishedAt,
      audience: a.audience,
      spoiler: hidden ? { kind: "hidden", titleId: "hidden" } : a.spoiler,
      kind: a.kind,
      likedByViewer: reactions.some(
        (r) => (r.body as { userId: string }).userId === viewer,
      ),
      reactionCount: reactions.length,
      replyCount: replies.length,
    };
  }
  async policyRevision() {
    return Number(
      (
        (await this.repo.read("social", "policy"))?.body as
          { revision: number } | undefined
      )?.revision ?? 0,
    );
  }
  private async socialWrite(ops: Operation[], policy = false) {
    if (policy) {
      const old = await this.repo.read("social", "policy");
      ops.push(
        this.updateOp(
          old,
          stored("social", "policy", {
            revision:
              ((old?.body as { revision: number } | undefined)?.revision ?? 0) +
              1,
          }),
        ),
      );
    }
    if ((await this.repo.transact("social", ops)) === "conflict")
      throw new ApiError(409, "social-conflict", "Please refresh and retry.");
  }
  async readFeed(viewer: Viewer, query: FeedQuery): Promise<ActivityPage> {
    const limit = Math.min(50, Math.max(1, query.limit));
    const revision = await this.policyRevision();
    let after: string | undefined;
    if (query.cursor) {
      const parsed = this.decodeCursor(query.cursor);
      if (
        parsed.viewer !== viewer.userId ||
        parsed.revision !== revision ||
        parsed.filter !== query.filter ||
        parsed.media !== query.media ||
        parsed.circleId !== query.circleId
      )
        throw new ApiError(
          409,
          "cursor-invalidated",
          "Your feed changed. Refresh to continue.",
        );
      after = parsed.after;
    }
    const following = viewer.userId
      ? (await this.repo.list("social", `follow:${viewer.userId}:`)).map(
          (r) => (r.body as { targetId: string }).targetId,
        )
      : [];
    if (following.length > 100) throw new ApiError(400, "following-limit");
    const visible: SocialActivity[] = [];
    for (const row of await this.repo.list("social", "activity:")) {
      const a = row.body as SocialActivity;
      if (
        query.filter === "following" &&
        a.authorId !== viewer.userId &&
        !following.includes(a.authorId)
      )
        continue;
      if (
        query.filter === "friends" &&
        a.authorId !== viewer.userId &&
        !(await this.visible(viewer.userId, a.authorId, { kind: "friends" }))
      )
        continue;
      if (
        query.filter === "circle" &&
        (a.audience.kind !== "circle" || a.audience.circleId !== query.circleId)
      )
        continue;
      if (!(await this.activityVisible(viewer.userId, a))) continue;
      if (query.media && (await this.getTitle(a.titleId)).media !== query.media)
        continue;
      visible.push(a);
    }
    visible.sort(
      (a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id),
    );
    const eligible = after
      ? visible.filter((a) => `${a.publishedAt}|${a.id}` < after)
      : visible;
    const page = eligible.slice(0, limit);
    const items = await Promise.all(
      page.map((a) => this.project(viewer.userId, a)),
    );
    const last = page.at(-1);
    return {
      items,
      etag: digest({ revision, items }),
      ...(eligible.length > limit && last
        ? {
            nextCursor: this.encodeCursor({
              viewer: viewer.userId,
              revision,
              filter: query.filter,
              media: query.media,
              circleId: query.circleId,
              after: `${last.publishedAt}|${last.id}`,
            }),
          }
        : {}),
    };
  }
  private encodeCursor(data: object) {
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.cursorSecret).update(encoded).digest("base64url")}`;
  }
  private decodeCursor(cursor: string): {
    viewer: string | null;
    revision: number;
    filter: string;
    media?: string;
    circleId?: string;
    after: string;
  } {
    try {
      const [encoded, signature] = cursor.split(".");
      const expected = createHmac("sha256", this.cursorSecret)
        .update(encoded)
        .digest("base64url");
      if (
        !signature ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        throw Error();
      return JSON.parse(Buffer.from(encoded, "base64url").toString());
    } catch {
      throw new ApiError(400, "invalid-cursor");
    }
  }
  async readActivity(viewer: Viewer, id: string) {
    const a = requireValue(
      (await this.repo.read("social", `activity:${id}`))?.body as
        SocialActivity | undefined,
    );
    if (!(await this.activityVisible(viewer.userId, a)))
      throw new ApiError(404, "activity-unavailable");
    return this.project(viewer.userId, a);
  }
  async discoverUsers(p: Principal, text: string): Promise<User[]> {
    const result: User[] = [];
    for (const row of await this.repo.list("social", "profile:")) {
      const u = row.body as User;
      if (
        u.id !== p.userId &&
        !(await this.blocked(p.userId, u.id)) &&
        (await this.active(u.id)) &&
        u.displayName.toLowerCase().includes(text.toLowerCase())
      )
        result.push(publicUser(u));
    }
    return result.slice(0, 50);
  }
  async follow(p: Principal, targetId: string, following = true) {
    if (targetId === p.userId) throw new ApiError(400, "cannot-follow-self");
    if (
      !(await this.active(targetId)) ||
      (await this.blocked(p.userId, targetId))
    )
      throw new ApiError(404, "user-unavailable");
    const id = `follow:${p.userId}:${targetId}`;
    const old = await this.repo.read("social", id);
    if (following && !old) {
      if ((await this.repo.list("social", `follow:${p.userId}:`)).length >= 100)
        throw new ApiError(400, "following-limit");
      await this.socialWriteFor(
        p,
        [
          {
            kind: "create",
            value: stored("social", id, { userId: p.userId, targetId }),
          },
        ],
        true,
      );
    }
    if (!following && old)
      await this.socialWriteFor(
        p,
        [{ kind: "delete", id, expectedEtag: old.etag }],
        true,
      );
  }
  async setFriendship(
    p: Principal,
    targetId: string,
    action: "request" | "accept" | "remove",
  ) {
    if (
      targetId === p.userId ||
      !(await this.active(targetId)) ||
      (await this.blocked(p.userId, targetId))
    )
      throw new ApiError(404, "user-unavailable");
    const id = `friend:${pair(p.userId, targetId)}`;
    const old = await this.repo.read("social", id);
    if (action === "remove") {
      if (old)
        await this.socialWriteFor(
          p,
          [{ kind: "delete", id, expectedEtag: old.etag }],
          true,
        );
      return;
    }
    if (
      action === "accept" &&
      (!old || (old.body as { requestedBy: string }).requestedBy !== targetId)
    )
      throw new ApiError(403, "request-required");
    if (action === "request" && old) return;
    await this.socialWriteFor(
      p,
      [
        this.updateOp(
          old,
          stored("social", id, {
            users: [p.userId, targetId],
            requestedBy: action === "request" ? p.userId : targetId,
            status: action === "accept" ? "accepted" : "pending",
          }),
        ),
      ],
      true,
    );
  }
  async socialStatus(p: Principal, userId: string) {
    if (await this.blocked(p.userId, userId))
      throw new ApiError(404, "user-unavailable");
    const friendship = (
      await this.repo.read("social", `friend:${pair(p.userId, userId)}`)
    )?.body;
    return {
      following: !!(await this.repo.read(
        "social",
        `follow:${p.userId}:${userId}`,
      )),
      followers: (await this.repo.list("social", "follow:")).filter(
        (r) => (r.body as { targetId: string }).targetId === userId,
      ).length,
      followingCount: (await this.repo.list("social", `follow:${userId}:`))
        .length,
      friendship: friendship ?? null,
    };
  }
  async readShowcase(viewer: Viewer, userId: string): Promise<Showcase> {
    if (sampleUsers.some((u) => u.id === userId))
      return sampleShowcase.userId === userId
        ? sampleShowcase
        : { userId, version: 0, theme: "lounge", shelves: [] };
    if (
      !(await this.active(userId)) ||
      (await this.blocked(viewer.userId, userId))
    )
      throw new ApiError(404, "profile-unavailable");
    const showcase = (await this.repo.read("social", `showcase:${userId}`))
      ?.body as Showcase | undefined;
    if (!showcase) return { userId, version: 0, theme: "lounge", shelves: [] };
    const shelves = [];
    for (const shelf of showcase.shelves)
      if (await this.visible(viewer.userId, userId, shelf.audience))
        shelves.push(shelf);
    return { ...showcase, shelves };
  }
  async saveShowcase(
    p: Principal,
    raw: { commandId: string; baseVersion: number; showcase: Showcase },
  ): Promise<CommandResult> {
    const input = showcaseSchema.parse(raw);
    if (input.showcase.userId !== p.userId)
      throw new ApiError(403, "wrong-owner");
    const cached = await this.receipt(p, input.commandId, input);
    if (cached) return cached;
    for (const shelf of input.showcase.shelves)
      for (const id of shelf.itemIds) await this.getTitle(id);
    if (input.showcase.featuredTitleId)
      await this.getTitle(input.showcase.featuredTitleId);
    const old = await this.repo.read("social", `showcase:${p.userId}`);
    if ((old?.version ?? 0) !== input.baseVersion)
      return {
        status: "conflict",
        commandId: input.commandId,
        currentVersion: old?.version ?? 0,
      };
    const version = input.baseVersion + 1;
    const result: CommandResult = {
      status: "accepted",
      commandId: input.commandId,
      version,
      eventId: `showcase:${input.commandId}`,
    };
    await this.socialWriteFor(
      p,
      [
        this.updateOp(
          old,
          stored(
            "social",
            `showcase:${p.userId}`,
            { ...input.showcase, version },
            version,
          ),
        ),
        {
          kind: "create",
          value: stored("social", `receipt:${p.userId}:${input.commandId}`, {
            hash: digest(input),
            result,
          }),
        },
      ],
      true,
    );
    return result;
  }
  async saveCollection(
    p: Principal,
    raw: Omit<Collection, "userId"> & { commandId: string },
  ): Promise<CommandResult> {
    const input = collectionSchema.parse(raw);
    const cached = await this.receipt(p, input.commandId, input);
    if (cached) return cached;
    for (const id of input.titleIds) await this.getTitle(id);
    const old = await this.repo.read("social", `collection:${input.id}`);
    if (old && (old.body as Collection).userId !== p.userId)
      throw new ApiError(403, "wrong-owner");
    if ((old?.version ?? 0) !== input.version)
      return {
        status: "conflict",
        commandId: input.commandId,
        currentVersion: old?.version ?? 0,
      };
    const version = input.version + 1;
    const result: CommandResult = {
      status: "accepted",
      commandId: input.commandId,
      version,
      eventId: `collection:${input.commandId}`,
    };
    await this.socialWriteFor(
      p,
      [
        this.updateOp(
          old,
          stored(
            "social",
            `collection:${input.id}`,
            { ...input, userId: p.userId, version },
            version,
          ),
        ),
        {
          kind: "create",
          value: stored("social", `receipt:${p.userId}:${input.commandId}`, {
            hash: digest(input),
            result,
          }),
        },
      ],
      true,
    );
    return result;
  }
  async readCollection(viewer: Viewer, id: string) {
    const collection = requireValue(
      (await this.repo.read("social", `collection:${id}`))?.body as
        Collection | undefined,
    );
    if (
      !(await this.visible(
        viewer.userId,
        collection.userId,
        collection.audience,
      ))
    )
      throw new ApiError(404, "collection-unavailable");
    return collection;
  }
  async readCollections(viewer: Viewer, userId?: string) {
    const result: Collection[] = [];
    for (const row of await this.repo.list("social", "collection:")) {
      const c = row.body as Collection;
      if (
        (!userId || userId === c.userId) &&
        (await this.visible(viewer.userId, c.userId, c.audience))
      )
        result.push(c);
    }
    return result.slice(0, 50);
  }
  async saveReviewDraft(
    p: Principal,
    input: {
      id: string;
      titleId: string;
      text: string;
      version: number;
      rating?: number;
    },
  ) {
    if (input.text.length > 10000) throw new ApiError(413, "review-too-long");
    await this.getTitle(input.titleId);
    const old = await this.repo.read(scope(p), `draft:${input.id}`);
    if ((old?.version ?? 0) !== input.version)
      throw new ApiError(409, "draft-conflict");
    const version = input.version + 1;
    if (
      (await this.ownerTransact(p, [
        this.updateOp(
          old,
          stored(scope(p), `draft:${input.id}`, { ...input, version }, version),
        ),
      ])) === "conflict"
    )
      throw new ApiError(409, "draft-conflict");
    return { id: input.id, version };
  }
  async readReviewDrafts(p: Principal) {
    return (await this.repo.list(scope(p), "draft:")).map((r) => r.body);
  }
  async publishReview(
    p: Principal,
    raw: Parameters<typeof reviewSchema.parse>[0],
  ): Promise<{ activityId: string }> {
    const input = reviewSchema.parse(raw);
    const receipt = await this.repo.read(
      "social",
      `review-receipt:${p.userId}:${input.commandId}`,
    );
    if (receipt) {
      if ((receipt.body as { hash: string }).hash !== digest(input))
        throw new ApiError(409, "command-payload-mismatch");
      return (receipt.body as { result: { activityId: string } }).result;
    }
    const draft = input.draftId
      ? await this.repo.read(scope(p), `draft:${input.draftId}`)
      : null;
    if (input.draftId && (!draft || draft.version !== input.baseVersion))
      throw new ApiError(409, "draft-conflict");
    const body = draft?.body as
      { titleId: string; text: string; rating?: number } | undefined;
    const titleId = input.titleId ?? body?.titleId;
    if (!titleId) throw new ApiError(400, "title-required");
    this.validateSpoiler(await this.getTitle(titleId), input.spoiler);
    const activityId = `review:${input.commandId}`;
    const a: SocialActivity = {
      id: activityId,
      authorId: p.userId,
      titleId,
      caption: "Published a review",
      note: input.text ?? body?.text ?? "",
      rating: input.rating ?? body?.rating,
      audience: input.audience,
      spoiler: input.spoiler,
      occurredAt: { precision: "instant", iso: new Date().toISOString() },
      publishedAt: new Date().toISOString(),
      kind: "review",
      draftId: input.draftId,
    };
    await this.socialWriteFor(p, [
      { kind: "create", value: stored("social", `activity:${activityId}`, a) },
      {
        kind: "create",
        value: stored(
          "social",
          `review-receipt:${p.userId}:${input.commandId}`,
          { hash: digest(input), result: { activityId } },
        ),
      },
      {
        kind: "create",
        value: stored("social", `notify:${activityId}`, {
          activityId,
          delivered: false,
        }),
      },
    ]);
    return { activityId };
  }
  async addReply(p: Principal, raw: Parameters<typeof replySchema.parse>[0]) {
    const input = replySchema.parse(raw);
    await this.readActivity(
      { userId: p.userId, policyRevision: 0 },
      input.activityId,
    );
    const rawParent = requireValue(
      (await this.repo.read("social", `activity:${input.activityId}`))?.body as
        SocialActivity | undefined,
    );
    this.validateSpoiler(await this.getTitle(rawParent.titleId), input.spoiler);
    const id = `reply:${input.activityId}:${p.userId}:${input.commandId}`;
    const old = await this.repo.read("social", id);
    if (old) {
      if ((old.body as { hash: string }).hash !== digest(input))
        throw new ApiError(409, "command-payload-mismatch");
      return { replyId: id };
    }
    await this.socialWriteFor(p, [
      {
        kind: "create",
        value: stored("social", id, {
          id,
          activityId: input.activityId,
          userId: p.userId,
          text: input.text,
          spoiler: input.spoiler,
          createdAt: new Date().toISOString(),
          hash: digest(input),
        }),
      },
    ]);
    return { replyId: id };
  }
  async readReplies(viewer: Viewer, activityId: string): Promise<Reply[]> {
    await this.readActivity(viewer, activityId);
    const result: Reply[] = [];
    for (const doc of await this.repo.list("social", `reply:${activityId}:`)) {
      const reply = doc.body as {
        id: string;
        userId: string;
        text: string;
        spoiler: SpoilerScope;
        createdAt: string;
      };
      if (
        (await this.blocked(viewer.userId, reply.userId)) ||
        !(await this.active(reply.userId))
      )
        continue;
      const hidden = !(await this.mayReveal(
        viewer.userId,
        reply.userId,
        reply.spoiler,
      ));
      result.push({
        id: reply.id,
        activityId,
        author: publicUser(
          requireValue(
            (await this.repo.read("social", `profile:${reply.userId}`))
              ?.body as User | undefined,
          ),
        ),
        ...(!hidden ? { text: reply.text } : {}),
        detailHidden: hidden,
        createdAt: reply.createdAt,
      });
    }
    return result.slice(-50);
  }
  async react(p: Principal, activityId: string, liked: boolean) {
    await this.readActivity(
      { userId: p.userId, policyRevision: 0 },
      activityId,
    );
    const id = `reaction:${activityId}:${p.userId}`;
    const old = await this.repo.read("social", id);
    if (liked && !old)
      await this.socialWriteFor(p, [
        {
          kind: "create",
          value: stored("social", id, { userId: p.userId, activityId }),
        },
      ]);
    if (!liked && old)
      await this.socialWriteFor(p, [
        { kind: "delete", id, expectedEtag: old.etag },
      ]);
  }
  async blockUser(p: Principal, targetId: string) {
    if (targetId === p.userId) throw new ApiError(400, "cannot-block-self");
    if (!(await this.active(targetId)))
      throw new ApiError(404, "user-unavailable");
    const id = `block:${p.userId}:${targetId}`;
    if (!(await this.repo.read("social", id)))
      await this.socialWriteFor(
        p,
        [
          {
            kind: "create",
            value: stored("social", id, { userId: p.userId, targetId }),
          },
        ],
        true,
      );
  }
  async reportContent(
    p: Principal,
    input: { targetId: string; reason: string; note?: string },
  ) {
    if (
      !["spam", "harassment", "spoiler", "other"].includes(input.reason) ||
      (input.note?.length ?? 0) > 2000
    )
      throw new ApiError(400, "invalid-report");
    const user = await this.repo.read("social", `profile:${input.targetId}`);
    if (user) {
      if (await this.blocked(p.userId, input.targetId))
        throw new ApiError(404, "user-unavailable");
    } else
      await this.readActivity(
        { userId: p.userId, policyRevision: 0 },
        input.targetId,
      );
    const reportId = randomUUID();
    await this.socialWriteFor(p, [
      {
        kind: "create",
        value: stored("social", `report:${reportId}`, {
          reportId,
          reporterId: p.userId,
          ...input,
          createdAt: new Date().toISOString(),
          status: "open",
        }),
      },
    ]);
    return { reportId };
  }
  async moderation(p: Principal) {
    if (!p.roles.includes("moderator"))
      throw new ApiError(403, "moderator-required");
    return (await this.repo.list("social", "report:")).map((r) => r.body);
  }
  async moderate(
    p: Principal,
    input: { targetId: string; action: "remove" | "suspend"; reason: string },
  ) {
    if (!p.roles.includes("moderator"))
      throw new ApiError(403, "moderator-required");
    if (input.action === "suspend") {
      const old = requireValue(
        await this.repo.read("social", `account:${input.targetId}`),
      );
      await this.socialWriteFor(
        p,
        [
          {
            kind: "replace",
            value: stored(
              "social",
              old.id,
              { ...(old.body as object), disabled: true },
              old.version + 1,
            ),
            expectedEtag: old.etag,
          },
          {
            kind: "create",
            value: stored("social", `audit:${randomUUID()}`, {
              moderatorId: p.userId,
              ...input,
              at: new Date().toISOString(),
            }),
          },
        ],
        true,
      );
    } else {
      const old = requireValue(
        await this.repo.read("social", `activity:${input.targetId}`),
      );
      await this.socialWriteFor(
        p,
        [
          {
            kind: "replace",
            value: stored(
              "social",
              old.id,
              { ...(old.body as object), retracted: true },
              old.version + 1,
            ),
            expectedEtag: old.etag,
          },
          {
            kind: "create",
            value: stored("social", `audit:${randomUUID()}`, {
              moderatorId: p.userId,
              ...input,
              at: new Date().toISOString(),
            }),
          },
        ],
        true,
      );
    }
  }
  async saveCircle(
    p: Principal,
    input: { id: string; name: string; memberIds: string[] },
  ) {
    if (input.name.length > 80 || input.memberIds.length > 8)
      throw new ApiError(400, "circle-limits");
    const old = await this.repo.read("social", `circle:${input.id}`);
    if (old && (old.body as { ownerId: string }).ownerId !== p.userId)
      throw new ApiError(403, "wrong-owner");
    for (const member of input.memberIds)
      if (
        member !== p.userId &&
        !(await this.visible(member, p.userId, { kind: "friends" }))
      )
        throw new ApiError(403, "accepted-friend-required");
    await this.socialWriteFor(
      p,
      [
        this.updateOp(
          old,
          stored("social", `circle:${input.id}`, {
            id: input.id,
            name: input.name,
            ownerId: p.userId,
            members: input.memberIds,
          }),
        ),
      ],
      true,
    );
    return { id: input.id };
  }
  async readCircles(p: Principal) {
    return (await this.repo.list("social", "circle:"))
      .map((r) => r.body)
      .filter((b) => (b as { ownerId: string }).ownerId === p.userId);
  }
  async editReview(
    p: Principal,
    input: {
      activityId: string;
      baseVersion: number;
      text?: string;
      retract: boolean;
    },
  ) {
    const old = requireValue(
      await this.repo.read("social", `activity:${input.activityId}`),
    );
    const activity = old.body as SocialActivity;
    if (activity.authorId !== p.userId || activity.kind !== "review")
      throw new ApiError(403, "wrong-owner");
    if (old.version !== input.baseVersion)
      throw new ApiError(409, "review-conflict");
    if ((input.text?.length ?? 0) > 10000)
      throw new ApiError(413, "review-too-long");
    await this.socialWriteFor(
      p,
      [
        {
          kind: "replace",
          value: stored(
            "social",
            old.id,
            {
              ...activity,
              ...(input.text === undefined ? {} : { note: input.text }),
              retracted: input.retract,
            },
            old.version + 1,
          ),
          expectedEtag: old.etag,
        },
      ],
      true,
    );
    return { activityId: input.activityId, version: old.version + 1 };
  }
  async editReply(
    p: Principal,
    input: { replyId: string; baseVersion: number; text: string },
  ) {
    const old = requireValue(await this.repo.read("social", input.replyId));
    const reply = old.body as { userId: string; activityId: string };
    if (reply.userId !== p.userId) throw new ApiError(403, "wrong-owner");
    await this.readActivity(
      { userId: p.userId, policyRevision: 0 },
      reply.activityId,
    );
    if (old.version !== input.baseVersion)
      throw new ApiError(409, "reply-conflict");
    if (!input.text.trim() || input.text.length > 2000)
      throw new ApiError(400, "reply-text-range");
    await this.socialWriteFor(p, [
      {
        kind: "replace",
        value: stored(
          "social",
          old.id,
          { ...(old.body as object), text: input.text },
          old.version + 1,
        ),
        expectedEtag: old.etag,
      },
    ]);
    return { replyId: input.replyId, version: old.version + 1 };
  }
  async ingestObservation(
    p: Principal,
    observation: ProviderObservation,
  ): Promise<CommandResult> {
    if (observation.accountId !== p.userId)
      throw new ApiError(403, "wrong-owner");
    if (observation.confidence !== "exact")
      return {
        status: "rejected",
        commandId: observation.observationId,
        code: "mapping-needs-review",
      };
    const commandId = `observation:${observation.source}:${observation.observationId}`;
    const current = (
      await this.repo.read(scope(p), `library:${observation.titleId}`)
    )?.body as LibraryItem | undefined;
    const receipt = await this.repo.read(scope(p), `command:${commandId}`);
    if (receipt) {
      const result = (receipt.body as Receipt).result;
      return result;
    }
    return this.applyProgress(p, {
      commandId,
      titleId: observation.titleId,
      baseVersion: current?.version ?? 0,
      change: observation.change,
      occurredAt: observation.occurredAt,
      audience: { kind: "private" },
      spoiler: { kind: "none" },
    });
  }
  async getSettings(p: Principal) {
    return (
      (await this.repo.read(scope(p), "settings"))?.body ?? {
        region: "US",
        timeZone: "UTC",
        defaultAudience: "private",
        lowData: false,
        reducedMotion: false,
        haptics: true,
      }
    );
  }
  async saveSettings(p: Principal, input: Record<string, unknown>) {
    const allowed = [
      "region",
      "timeZone",
      "defaultAudience",
      "lowData",
      "reducedMotion",
      "haptics",
      "notificationPreferences",
    ];
    const cleaned = Object.fromEntries(
      Object.entries(input).filter(([key]) => allowed.includes(key)),
    );
    const old = await this.repo.read(scope(p), "settings");
    const next = { ...((await this.getSettings(p)) as object), ...cleaned };
    await this.ownerTransact(p, [
      this.updateOp(old, stored(scope(p), "settings", next)),
    ]);
    return next;
  }
  async exportAccount(p: Principal) {
    const downloadId = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
    const records = await this.repo.list(scope(p));
    const account = await this.repo.read("social", `account:${p.userId}`);
    const social = (await this.repo.list("social"))
      .filter((r) => {
        const body = r.body as { userId?: string; authorId?: string };
        return body.userId === p.userId || body.authorId === p.userId;
      })
      .filter(
        (r) => !r.id.startsWith("receipt:") && !r.id.startsWith("session:"),
      );
    const data = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      user: (account?.body as { user: User }).user,
      privateRecords: records
        .filter((r) => !r.id.startsWith("export:") && r.id !== "write-guard")
        .map((r) => ({ id: r.id, version: r.version, body: r.body })),
      socialRecords: social.map((r) => ({ id: r.id, body: r.body })),
    };
    const oldExports = await this.repo.list(scope(p), "export:");
    if (
      (await this.ownerTransact(p, [
        ...oldExports.map((r) => ({
          kind: "delete" as const,
          id: r.id,
          expectedEtag: r.etag,
        })),
        {
          kind: "create",
          value: stored(scope(p), `export:${downloadId}`, { expiresAt, data }),
        },
      ])) === "conflict"
    )
      throw new ApiError(409, "export-conflict");
    return {
      downloadId,
      expiresAt,
      downloadUrl: `/api/account/download?id=${downloadId}`,
    };
  }
  async downloadExport(p: Principal, id: string) {
    const record = requireValue(await this.repo.read(scope(p), `export:${id}`));
    const body = record.body as { expiresAt: string; data: unknown };
    if (Date.parse(body.expiresAt) <= Date.now()) {
      await this.repo.transact(scope(p), [
        { kind: "delete", id: record.id, expectedEtag: record.etag },
      ]);
      throw new ApiError(410, "export-expired");
    }
    return body.data;
  }
  async cleanupExpiredExports(userId: string) {
    for (const record of await this.repo.list(`user:${userId}`, "export:"))
      if (
        Date.parse((record.body as { expiresAt: string }).expiresAt) <=
        Date.now()
      ) {
        if (
          (await this.repo.transact(`user:${userId}`, [
            { kind: "delete", id: record.id, expectedEtag: record.etag },
          ])) === "conflict"
        )
          throw new ApiError(409, "export-cleanup-conflict");
      }
  }
  async requestDeletion(p: Principal) {
    const account = requireValue(
      await this.repo.read("social", `account:${p.userId}`),
    );
    const jobId = randomUUID();
    await this.socialWrite(
      [
        {
          kind: "replace",
          value: stored(
            "social",
            account.id,
            { ...(account.body as object), disabled: true },
            account.version + 1,
          ),
          expectedEtag: account.etag,
        },
        {
          kind: "create",
          value: stored("social", `deletion:${jobId}`, {
            jobId,
            userId: p.userId,
            status: "queued",
            requestedAt: new Date().toISOString(),
          }),
        },
      ],
      true,
    );
    const guard = await this.repo.read(scope(p), "write-guard");
    if (
      (await this.repo.transact(scope(p), [
        this.updateOp(
          guard,
          stored(
            scope(p),
            "write-guard",
            { closed: true },
            (guard?.version ?? 0) + 1,
          ),
        ),
      ])) === "conflict"
    )
      throw new ApiError(409, "deletion-conflict");
    return { jobId };
  }
  async processDeletion(jobId: string) {
    const job = requireValue(
      await this.repo.read("social", `deletion:${jobId}`),
    );
    const body = job.body as { userId: string; status: string };
    if (body.status === "done") return;
    const userId = body.userId;
    const guard=await this.repo.read(`user:${userId}`,"write-guard");
    if(!(guard?.body as {closed?:boolean}|undefined)?.closed && await this.repo.transact(`user:${userId}`,[this.updateOp(guard,stored(`user:${userId}`,"write-guard",{closed:true},(guard?.version??0)+1))]) === "conflict")throw new ApiError(409,"deletion-conflict");
    const privateRows = (await this.repo.list(`user:${userId}`)).filter(
      (r) => r.id !== "write-guard",
    );
    for (let i = 0; i < privateRows.length; i += 90)
      if (
        (await this.repo.transact(
          `user:${userId}`,
          privateRows
            .slice(i, i + 90)
            .map((r) => ({ kind: "delete", id: r.id, expectedEtag: r.etag })),
        )) === "conflict"
      )
        throw new ApiError(409, "deletion-conflict");
    const rows = await this.repo.list("social");
    const deletes = rows.filter((r) => {
      if (
        r.id === job.id ||
        r.id.startsWith("audit:") ||
        r.id.startsWith("report:")
      )
        return false;
      const b = r.body as {
        userId?: string;
        authorId?: string;
        targetId?: string;
        user?: User;
        users?: string[];
      };
      return (
        b.userId === userId ||
        b.authorId === userId ||
        b.targetId === userId ||
        b.user?.id === userId ||
        b.users?.includes(userId) ||
        r.id === `profile:${userId}` ||
        r.id === `showcase:${userId}`
      );
    });
    for (let i = 0; i < deletes.length; i += 90)
      if (
        (await this.repo.transact(
          "social",
          deletes
            .slice(i, i + 90)
            .map((r) => ({ kind: "delete", id: r.id, expectedEtag: r.etag })),
        )) === "conflict"
      )
        throw new ApiError(409, "deletion-conflict");
    if (
      (await this.repo.transact("social", [
        {
          kind: "replace",
          value: stored("social", job.id, {
            ...body,
            status: "done",
            completedAt: new Date().toISOString(),
          }),
          expectedEtag: job.etag,
        },
      ])) === "conflict"
    )
      throw new ApiError(409, "deletion-conflict");
  }
}
