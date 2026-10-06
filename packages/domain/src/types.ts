export type Id = string;
export type MediaType = "movie" | "show" | "game";
export type Source =
  | "manual"
  | "letterboxd"
  | "trakt"
  | "csv"
  | "steam"
  | "netflix-extension"
  | "retroachievements";
export type Audience =
  | { kind: "private" }
  | { kind: "public" }
  | { kind: "friends" }
  | { kind: "circle"; circleId: Id };
export type DateValue =
  | { precision: "instant"; iso: string }
  | { precision: "day"; day: string }
  | { precision: "month"; month: string }
  | { precision: "unknown" };
export type SpoilerScope =
  | { kind: "none" }
  | { kind: "episodes"; showId: Id; requiredEpisodeIds: Id[] }
  | { kind: "milestone"; gameId: Id; requiredMilestoneIds: Id[] }
  | { kind: "hidden"; titleId: Id };
export type ProgressChange =
  | {
      kind: "session-started" | "session-ended";
      titleId: Id;
      runId: Id;
      sessionId: Id;
      medium: MediaType;
    }
  | { kind: "movie-viewed"; titleId: Id; runId: Id }
  | {
      kind: "episode-watched" | "episode-skipped";
      titleId: Id;
      episodeId: Id;
      runId: Id;
    }
  | {
      kind: "game-session";
      titleId: Id;
      runId: Id;
      minutes?: number;
      playedOn?: string;
      emulator?: string;
    }
  | {
      kind: "milestone";
      titleId: Id;
      runId: Id;
      milestoneId: Id;
      label: string;
    }
  | { kind: "story-completed"; titleId: Id; runId: Id }
  | {
      kind: "achievement";
      titleId: Id;
      providerGameId: string;
      achievementId: string;
      mode?: "casual" | "hardcore";
    };
export type ProgressCommand = {
  commandId: Id;
  titleId: Id;
  baseVersion: number;
  change: ProgressChange;
  occurredAt: DateValue;
  rating?: number;
  liked?: boolean;
  note?: string;
  audience: Audience;
  spoiler: SpoilerScope;
};
export type CommandResult =
  | { status: "accepted"; commandId: Id; version: number; eventId: Id }
  | { status: "conflict"; commandId: Id; currentVersion: number }
  | { status: "rejected"; commandId: Id; code: string };
export type Viewer = { userId: Id | null; policyRevision: number };
export type FeedQuery = {
  cursor?: string;
  limit: number;
  filter: "following" | "friends" | "circle";
  circleId?: Id;
  media?: MediaType;
};
export type VisibleActivity = {
  id: Id;
  authorId: Id;
  titleId: Id;
  caption: string;
  note?: string;
  detailHidden: boolean;
  occurredAt: DateValue;
};
export type FeedPage = {
  items: VisibleActivity[];
  nextCursor?: string;
  etag: string;
};
export type ProviderObservation = {
  observationId: string;
  source: Exclude<Source, "manual">;
  accountId: Id;
  providerRecordId?: string;
  titleId: Id;
  change: ProgressChange;
  occurredAt: DateValue;
  observedAt: string;
  historical: boolean;
  confidence: "exact" | "needs-review";
  payloadHash: string;
};
export type Principal = { userId: Id; roles: ("user" | "moderator")[] };
export type LibraryPatch = {
  rating?: number | null;
  liked?: boolean;
  note?: string;
  owned?: boolean;
  archived?: boolean;
  state?: "planned" | "active" | "paused" | "dropped" | "completed";
  playedOn?: string;
  emulator?: string;
};
export type LibraryEditCommand = {
  commandId: Id;
  titleId: Id;
  baseVersion: number;
  patch: LibraryPatch;
};

export type Episode = {
  id: Id;
  order: number;
  releasedAt: string | null;
  title?: string;
  season?: number;
  number?: number;
};
export type Run = {
  id: Id;
  watchedEpisodeIds: Id[];
  skippedEpisodeIds: Id[];
  movieViewed: boolean;
  storyCompleted: boolean;
  minutes: number;
  milestoneIds: Id[];
  sessionActive: boolean;
  playedOn?: string;
  emulator?: string;
};
export type LibraryItem = {
  titleId: Id;
  version: number;
  state: "planned" | "active" | "paused" | "dropped" | "completed";
  rating?: number;
  liked?: boolean;
  note?: string;
  owned?: boolean;
  archived?: boolean;
  playedOn?: string;
  emulator?: string;
  runs: Run[];
  achievementIds: string[];
  updatedAt?: string;
};
export type CatalogHit = {
  id: Id;
  media: MediaType;
  title: string;
  year?: number;
  providerIds: Record<string, string>;
  artwork?: string;
  backdrop?: string;
  synopsis?: string;
  genres?: string[];
  platform?: string;
  ended?: boolean;
  episodes?: Episode[];
  sample?: boolean;
  artworkAttribution?: string;
};
export type User = {
  id: Id;
  displayName: string;
  email?: string;
  roles: ("user" | "moderator")[];
  sample?: boolean;
  bio?: string;
};
export type Session = { token: string; expiresAt: string; user: User };
export type Shelf = {
  id: Id;
  title: string;
  layout: "covers" | "spread" | "milestones";
  itemIds: Id[];
  audience: Audience;
};
export type Showcase = {
  userId: Id;
  version: number;
  theme: "lounge" | "matinee" | "midnight";
  featuredTitleId?: Id;
  shelves: Shelf[];
};
export type Collection = {
  id: Id;
  userId: Id;
  version: number;
  title: string;
  description?: string;
  titleIds: Id[];
  audience: Audience;
};
export type CorrectionCommand = {
  commandId: Id;
  eventId: Id;
  baseVersion: number;
  retract: boolean;
  replacement?: ProgressChange;
};
export type Activity = VisibleActivity & {
  author: User;
  title: CatalogHit;
  audience: Audience;
  spoiler: SpoilerScope;
  publishedAt: string;
  kind: "progress" | "review";
  likedByViewer: boolean;
  reactionCount: number;
  replyCount: number;
  rating?: number;
  sample?: boolean;
};
export type ActivityPage = Omit<FeedPage, "items"> & { items: Activity[] };
export type Reply = {
  id: Id;
  activityId: Id;
  author: User;
  text?: string;
  detailHidden: boolean;
  createdAt: string;
};
export type Preview = {
  sample: true;
  label: string;
  catalog: CatalogHit[];
  feed: ActivityPage;
  showcase: Showcase;
  users: User[];
};
