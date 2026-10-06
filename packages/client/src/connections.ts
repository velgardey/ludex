import type { CatalogHit } from "../../domain/src/types.ts";

export type ImportSource = "csv" | "letterboxd";

export type ConnectionAccount = {
  source: string;
  providerUser?: string;
  shareCompletions?: boolean;
  lastSuccess?: string | null;
  lastError?: string | null;
};

export type SteamCapability = {
  configured: boolean;
  supported: boolean;
  accountLinked: boolean;
  mode: string;
};

export type ConnectionCapabilities = {
  steam: boolean | SteamCapability;
  netflixCapture: boolean;
  csv: boolean;
  letterboxd: boolean;
  retroachievements: boolean;
  trakt: boolean;
};

export type ConnectionsOverview = {
  connections: ConnectionAccount[];
  capabilities: Partial<ConnectionCapabilities>;
};

export type ConnectionObservation = {
  id: string;
  source: string;
  status: string;
  observedAt: string;
  payload: Record<string, unknown>;
};

export type SteamPreviewObservation = {
  id: string;
  title: string;
  appId: string;
  minutes: number;
  matchedTitleId?: string;
  status: string;
};

export type SteamPreview = {
  observations: SteamPreviewObservation[];
  truncated?: boolean;
  nextOffset?: number;
};

export type ObservationConfirmation = {
  titleId: string;
  media: "movie" | "show" | "game";
  episodeId?: string;
  date?: string;
};

export type ImportRow = {
  id: string;
  title: string;
  year?: number;
  media: "movie" | "show" | "game" | string;
  date?: string;
  rating?: number;
  note?: string;
  emulator?: string;
  playedOn?: string;
  state?: string;
  episodeId?: string;
  episodeTitle?: string;
  matchedTitleId?: string;
  status: string;
  outcome?: string;
};

export type ImportPreview = {
  id: string;
  source: ImportSource;
  rows: ImportRow[];
  status: string;
  quietImport?: boolean;
};

export type ImportRowMatchInput = {
  titleId: string;
  episodeId?: string;
};

export type ImportRowMatchResult = {
  id: string;
  status: string;
  matchedTitleId: string;
  episodeId?: string;
};

export type ImportBatch = {
  id: string;
  source: string;
  status: string;
  createdAt: string;
};

export type ImportJob = {
  jobId: string;
  status: "queued" | "running" | "partial" | "completed" | "failed" | (string & {});
  accepted: number;
  remaining: number;
  rows: ImportRow[];
};

export type CreatePlanInput = {
  title: string;
  memberIds: string[];
  startsAt: string;
};

export type PlanSummary = {
  id: string;
  ownerId: string;
  title: string;
  startsAt?: string | null;
  version: number;
  rsvp: "pending" | "yes" | "no" | "maybe" | string;
};

export type PlanCandidate = {
  titleId: string;
  addedBy: string;
};

export type PlanDetail = {
  id: string;
  ownerId: string;
  title: string;
  startsAt?: string | null;
  version: number;
  candidates: PlanCandidate[];
};

export type DiscussionScope =
  | { kind: "none" }
  | { kind: "episodes"; showId: string; requiredEpisodeIds: string[] }
  | { kind: "milestone"; gameId: string; requiredMilestoneIds: string[] };

export type PlanDiscussionMessage = {
  id: string;
  authorId: string;
  createdAt: string;
  detailHidden: boolean;
  text?: string;
  scope?: DiscussionScope;
};

export type ConnectionsRequest = {
  request(path: string, body?: unknown, method?: string): Promise<unknown>;
};

function planPath(planId: string) {
  return `/plans/${encodeURIComponent(planId)}`;
}

function importJobPath(pollUrl: string) {
  const match = /^\/(?:api\/)?imports\/jobs\/([A-Za-z0-9_-]+)$/.exec(pollUrl);
  if (!match) throw new Error("The import job poll URL is invalid.");
  return `/imports/jobs/${encodeURIComponent(match[1])}`;
}

export function createConnectionsClient(requester: ConnectionsRequest) {
  return {
    readConnections(): Promise<ConnectionsOverview> {
      return requester.request("/connections") as Promise<ConnectionsOverview>;
    },
    readObservations(): Promise<ConnectionObservation[]> {
      return requester.request("/connections/observations") as Promise<ConnectionObservation[]>;
    },
    previewSteam(steamId64: string, offset?: number): Promise<SteamPreview> {
      if (!/^\d{17}$/.test(steamId64))
        return Promise.reject(new Error("Enter a 17-digit Steam ID64."));
      if (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
        return Promise.reject(new Error("The Steam preview offset is invalid."));
      return requester.request(
        "/connections/steam/preview",
        { steamId64, ...(offset === undefined ? {} : { offset }) },
      ) as Promise<SteamPreview>;
    },
    confirmObservation(
      observationId: string,
      input: ObservationConfirmation,
    ): Promise<unknown> {
      if (!observationId.trim()) return Promise.reject(new Error("An observation is required."));
      if (!input.titleId.trim()) return Promise.reject(new Error("Choose a matching Ludex title."));
      if (input.media === "show" && !input.episodeId?.trim())
        return Promise.reject(new Error("Choose an episode for a series capture."));
      return requester.request(
        `/connections/observations/${encodeURIComponent(observationId)}/confirm`,
        input,
      );
    },
    previewImport(source: string, csv: string): Promise<ImportPreview> {
      if (source !== "csv" && source !== "letterboxd")
        return Promise.reject(new Error("Choose a supported import source."));
      if (!csv.trim()) return Promise.reject(new Error("Add CSV content before previewing."));
      return requester.request("/imports/preview", { source, csv }) as Promise<ImportPreview>;
    },
    searchCatalog(text: string, media?: string): Promise<CatalogHit[]> {
      const query = text.trim();
      if (!query) return Promise.reject(new Error("Enter a title to search the catalog."));
      const params = new URLSearchParams({ text: query });
      if (media) params.set("media", media);
      return requester.request(`/catalog/search?${params}`) as Promise<CatalogHit[]>;
    },
    matchImportRow(
      batchId: string,
      rowId: string,
      input: ImportRowMatchInput,
    ): Promise<ImportRowMatchResult> {
      const batch = batchId.trim();
      const row = rowId.trim();
      const titleId = input.titleId.trim();
      const episodeId = input.episodeId?.trim();
      if (!batch) return Promise.reject(new Error("An import batch is required."));
      if (!row) return Promise.reject(new Error("An import row is required."));
      if (!titleId) return Promise.reject(new Error("Choose a catalog title."));
      if (input.episodeId !== undefined && !episodeId)
        return Promise.reject(new Error("Choose an episode or clear the episode selection."));
      return requester.request(
        `/imports/${encodeURIComponent(batch)}/rows/${encodeURIComponent(row)}/match`,
        { titleId, ...(episodeId ? { episodeId } : {}) },
      ) as Promise<ImportRowMatchResult>;
    },
    readImports(): Promise<ImportBatch[]> {
      return requester.request("/imports") as Promise<ImportBatch[]>;
    },
    commitImport(batchId: string): Promise<unknown> {
      return requester.request(
        `/imports/${encodeURIComponent(batchId)}/commit`,
        undefined,
        "POST",
      );
    },
    readImportJob(pollUrl: string): Promise<ImportJob> {
      try {
        return requester.request(importJobPath(pollUrl)) as Promise<ImportJob>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    readPlans(): Promise<PlanSummary[]> {
      return requester.request("/plans") as Promise<PlanSummary[]>;
    },
    createPlan(input: CreatePlanInput): Promise<{ id: string; version: number }> {
      return requester.request("/plans", input) as Promise<{ id: string; version: number }>;
    },
    readPlan(planId: string): Promise<PlanDetail> {
      return requester.request(planPath(planId)) as Promise<PlanDetail>;
    },
    addShortlist(planId: string, titleId: string): Promise<{ titleId: string }> {
      return requester.request(`${planPath(planId)}/shortlist`, { titleId }) as Promise<{ titleId: string }>;
    },
    setRsvp(
      planId: string,
      rsvp: "yes" | "no" | "maybe",
    ): Promise<{ rsvp: "yes" | "no" | "maybe" }> {
      return requester.request(`${planPath(planId)}/rsvp`, { rsvp }) as Promise<{
        rsvp: "yes" | "no" | "maybe";
      }>;
    },
    readDiscussion(planId: string): Promise<PlanDiscussionMessage[]> {
      return requester.request(`${planPath(planId)}/discussion`) as Promise<PlanDiscussionMessage[]>;
    },
    addDiscussion(
      planId: string,
      text: string,
      scope: DiscussionScope,
    ): Promise<{ id: string }> {
      if (!text.trim()) return Promise.reject(new Error("A discussion message is required."));
      return requester.request(`${planPath(planId)}/discussion`, { text, scope }) as Promise<{
        id: string;
      }>;
    },
  };
}
