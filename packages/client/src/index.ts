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
  Preview,
  ProgressCommand,
  Reply,
  Session,
  Showcase,
  SpoilerScope,
  User,
} from "../../domain/src/types.ts";
export * from "../../domain/src/index.ts";
export class LudexError extends Error {
  code: string;
  status: number;
  retryAfterSeconds?: number;
  constructor(
    status: number,
    body: { code?: string; message?: string; retryAfterSeconds?: number },
  ) {
    super(body.message ?? "Request failed");
    this.name = "LudexError";
    this.status = status;
    this.code = body.code ?? "request-failed";
    this.retryAfterSeconds = body.retryAfterSeconds;
  }
}
export class LudexClient {
  readonly baseUrl: string;
  private token: string | null;
  private transport: typeof fetch;
  constructor(
    options: {
      baseUrl?: string;
      token?: string | null;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:4000/api").replace(
      /\/$/,
      "",
    );
    this.token = options.token ?? null;
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  setToken(token: string | null) {
    this.token = token;
  }
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await this.transport(`${this.baseUrl}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (
      !response.ok &&
      !(
        (response.status === 409 && data.status === "conflict") ||
        (response.status === 400 && data.status === "rejected")
      )
    )
      throw new LudexError(response.status, data);
    return data as T;
  }
  async signup(input: {
    inviteCode: string;
    email: string;
    password: string;
    displayName: string;
  }): Promise<Session> {
    const session = await this.request<Session>("/auth/signup", input);
    this.setToken(session.token);
    return session;
  }
  async login(input: { email: string; password: string }): Promise<Session> {
    const session = await this.request<Session>("/auth/login", input);
    this.setToken(session.token);
    return session;
  }
  async logout(): Promise<void> {
    await this.request("/auth/logout", {});
    this.setToken(null);
  }
  me(): Promise<User> {
    return this.request("/auth/me");
  }
  preview(): Promise<Preview> {
    return this.request("/preview");
  }
  searchCatalog(
    query: { text?: string; media?: string; region?: string } = {},
  ): Promise<CatalogHit[]> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value) search.set(key, value);
    return this.request(`/catalog/search?${search}`);
  }
  getTitle(id: string): Promise<CatalogHit> {
    return this.request(`/catalog/title?id=${encodeURIComponent(id)}`);
  }
  readLibrary(): Promise<LibraryItem[]> {
    return this.request("/library");
  }
  applyProgress(command: ProgressCommand): Promise<CommandResult> {
    return this.request("/progress", command);
  }
  editLibrary(command: LibraryEditCommand): Promise<CommandResult> {
    return this.request("/library/edit", command);
  }
  correctProgress(command: CorrectionCommand): Promise<CommandResult> {
    return this.request("/progress/correct", command);
  }
  readFeed(
    query: FeedQuery = { limit: 20, filter: "following" },
  ): Promise<ActivityPage> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) search.set(key, String(value));
    return this.request(`/feed?${search}`);
  }
  readActivity(id: string): Promise<Activity> {
    return this.request(`/activity?id=${encodeURIComponent(id)}`);
  }
  readReplies(activityId: string): Promise<Reply[]> {
    return this.request(
      `/social/replies?activityId=${encodeURIComponent(activityId)}`,
    );
  }
  readShowcase(userId: string): Promise<Showcase> {
    return this.request(`/showcase?userId=${encodeURIComponent(userId)}`);
  }
  saveShowcase(input: {
    commandId: string;
    baseVersion: number;
    showcase: Showcase;
  }): Promise<CommandResult> {
    return this.request("/showcase", input);
  }
  saveCollection(
    input: Omit<Collection, "userId"> & { commandId: string },
  ): Promise<CommandResult> {
    return this.request("/collection", input);
  }
  readCollection(id: string): Promise<Collection> {
    return this.request(`/collection?id=${encodeURIComponent(id)}`);
  }
  readCollections(userId?: string): Promise<Collection[]> {
    return this.request(
      `/collections${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    );
  }
  readReviewDrafts(): Promise<
    {
      id: string;
      titleId: string;
      text: string;
      version: number;
      rating?: number;
    }[]
  > {
    return this.request("/social/review/drafts");
  }
  socialStatus(userId: string): Promise<{
    following: boolean;
    followers: number;
    followingCount: number;
    friendship: unknown;
  }> {
    return this.request(`/social/status?userId=${encodeURIComponent(userId)}`);
  }
  readUsers(text = ""): Promise<User[]> {
    return this.discoverUsers(text);
  }
  searchPeople(text = ""): Promise<User[]> {
    return this.discoverUsers(text);
  }
  discoverUsers(text = ""): Promise<User[]> {
    return this.request(`/social/users?text=${encodeURIComponent(text)}`);
  }
  follow(targetId: string, following = true): Promise<void> {
    return this.request("/social/follow", { targetId, following });
  }
  setFriendship(
    targetId: string,
    action: "request" | "accept" | "remove",
  ): Promise<void> {
    return this.request("/social/friendship", { targetId, action });
  }
  publishReview(input: {
    commandId: string;
    draftId?: string;
    baseVersion: number;
    titleId?: string;
    text?: string;
    rating?: number;
    audience: Audience;
    spoiler: SpoilerScope;
  }): Promise<{ activityId: string }> {
    return this.request("/social/review/publish", input);
  }
  saveReviewDraft(input: {
    id: string;
    titleId: string;
    text: string;
    version: number;
    rating?: number;
  }): Promise<{ id: string; version: number }> {
    return this.request("/social/review/draft", input);
  }
  addReply(input: {
    commandId: string;
    activityId: string;
    text: string;
    spoiler: SpoilerScope;
  }): Promise<{ replyId: string }> {
    return this.request("/social/reply", input);
  }
  react(activityId: string, liked: boolean): Promise<void> {
    return this.request("/social/react", { activityId, liked });
  }
  blockUser(targetId: string): Promise<void> {
    return this.request("/social/block", { targetId });
  }
  reportContent(input: {
    targetId: string;
    reason: "spam" | "harassment" | "spoiler" | "other";
    note?: string;
  }): Promise<{ reportId: string }> {
    return this.request("/social/report", input);
  }
  exportAccount(): Promise<{
    downloadId: string;
    expiresAt: string;
    downloadUrl: string;
  }> {
    return this.request("/account/export", {});
  }
  requestDeletion(): Promise<{ jobId: string }> {
    return this.request("/account/delete", {});
  }
  saveCircle(input: {
    id: string;
    name: string;
    memberIds: string[];
  }): Promise<{ id: string }> {
    return this.request("/social/circles", input);
  }
  readCircles(): Promise<
    { id: string; name: string; ownerId: string; members: string[] }[]
  > {
    return this.request("/social/circles");
  }
  editReview(input: {
    activityId: string;
    baseVersion: number;
    text?: string;
    retract: boolean;
  }): Promise<{ activityId: string; version: number }> {
    return this.request("/social/review/edit", input);
  }
  editReply(input: {
    replyId: string;
    baseVersion: number;
    text: string;
  }): Promise<{ replyId: string; version: number }> {
    return this.request("/social/reply/edit", input);
  }
  getSettings(): Promise<Record<string, unknown>> {
    return this.request("/account/settings");
  }
  saveSettings(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request("/account/settings", input);
  }
  moderationAction(input: {
    targetId: string;
    action: "remove" | "suspend";
    reason: string;
  }): Promise<void> {
    return this.request("/moderation", input);
  }
  moderation(): Promise<Record<string, unknown>[]> {
    return this.request("/moderation");
  }
}
