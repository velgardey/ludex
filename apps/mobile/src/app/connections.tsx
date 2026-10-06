import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Button, Text, TextInput } from "react-native-paper";
import { LudexError } from "@ludex/client";
import {
  createConnectionsClient,
  type ConnectionObservation,
  type ConnectionsOverview,
  type ImportJob,
  type ImportPreview,
  type SteamPreviewObservation,
} from "../../../../packages/client/src/connections.ts";
import type { CatalogHit } from "@ludex/domain";
import { useLudex } from "../state";
import { Heading, Page } from "../ui";
import { colors, type } from "../theme";

type ActiveJob = { pollUrl: string; value: ImportJob };

export default function ConnectionsScreen() {
  const { client, ready, session, setNotice, catalog } = useLudex();
  return (
    <ConnectionsContent
      key={session?.user.id ?? "guest"}
      client={client}
      ready={ready}
      session={session}
      setNotice={setNotice}
      catalog={catalog}
    />
  );
}

function ConnectionsContent({
  client,
  ready,
  session,
  setNotice,
  catalog,
}: {
  client: ReturnType<typeof useLudex>["client"];
  ready: boolean;
  session: ReturnType<typeof useLudex>["session"];
  setNotice: ReturnType<typeof useLudex>["setNotice"];
  catalog: CatalogHit[];
}) {
  const api = useMemo(() => createConnectionsClient(client), [client]);
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null);
  const [observations, setObservations] = useState<ConnectionObservation[]>([]);
  const [imports, setImports] = useState<Awaited<ReturnType<typeof api.readImports>>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<"csv" | "letterboxd">("csv");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [pollError, setPollError] = useState("");
  const [pollVersion, setPollVersion] = useState(0);
  const [steamId64, setSteamId64] = useState("");
  const [steamRows, setSteamRows] = useState<SteamPreviewObservation[]>([]);
  const [steamLoadedId, setSteamLoadedId] = useState("");
  const [steamNextOffset, setSteamNextOffset] = useState<number | null>(null);
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamError, setSteamError] = useState("");
  const version = useRef(0);
  const steamVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!ready || !session) return;
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextObservations, nextImports] = await Promise.all([
        api.readConnections(),
        api.readObservations(),
        api.readImports(),
      ]);
      if (current !== version.current) return;
      setOverview(nextOverview);
      setObservations(nextObservations);
      setImports(nextImports);
    } catch (cause) {
      if (current === version.current) setError(failureMessage(cause));
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [api, ready, session]);

  useEffect(() => {
    if (ready && session) void refresh();
    return () => {
      version.current++;
    };
  }, [ready, refresh, session?.user.id]);

  useEffect(() => {
    if (!session || !activeJob) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      setPollError("");
      try {
        const value = await api.readImportJob(activeJob.pollUrl);
        if (cancelled) return;
        setActiveJob({ ...activeJob, value });
        if (value.status === "queued" || value.status === "running") {
          timer = setTimeout(() => void poll(), 1100);
        } else {
          void refresh();
        }
      } catch (cause) {
        if (!cancelled) setPollError(failureMessage(cause));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJob?.pollUrl, api, pollVersion, refresh, session]);

  const matched = preview?.rows.filter(isMatched) ?? [];
  const unmatched = preview?.rows.filter((row) => !isMatched(row)) ?? [];
  const steamCapability = overview?.capabilities.steam;
  const steamConfigured = typeof steamCapability === "boolean" ? steamCapability : !!steamCapability?.configured;
  const steamSupported = typeof steamCapability === "boolean" ? steamCapability : !!steamCapability?.supported;
  const currentSteamRows = steamLoadedId === steamId64.trim() ? steamRows : [];

  async function previewSteam(offset?: number) {
    if (!session || !steamId64.trim() || steamBusy) return;
    const request = ++steamVersion.current;
    const requestedId = steamId64.trim();
    setSteamBusy(true);
    setSteamError("");
    if (offset === undefined) {
      setSteamRows([]);
      setSteamLoadedId("");
      setSteamNextOffset(null);
    }
    try {
      const result = await api.previewSteam(requestedId, offset);
      if (request !== steamVersion.current) return;
      setSteamLoadedId(requestedId);
      setSteamRows((current) => offset === undefined ? result.observations : [...current, ...result.observations]);
      setSteamNextOffset(result.truncated && typeof result.nextOffset === "number" ? result.nextOffset : null);
    } catch (cause) {
      if (request === steamVersion.current) setSteamError(failureMessage(cause));
    } finally {
      if (request === steamVersion.current) setSteamBusy(false);
    }
  }

  async function confirmObservation(observationId: string, choice: { titleId: string; media: "movie" | "show" | "game"; episodeId?: string }, steam = false) {
    try {
      await api.confirmObservation(observationId, choice);
      if (steam) setSteamRows((current) => current.filter((row) => row.id !== observationId));
      else await refresh();
    } catch (cause) {
      throw new Error(failureMessage(cause));
    }
  }

  async function makePreview() {
    if (!session || !csv.trim() || busy) return;
    setError("");
    setBusy(true);
    setPreview(null);
    setConfirmed(false);
    try {
      setPreview(await api.previewImport(source, csv));
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!session || !preview || !confirmed || !matched.length || busy) return;
    setBusy(true);
    setError("");
    setPollError("");
    try {
      const result = objectValue(await api.commitImport(preview.id));
      if (!result || typeof result.jobId !== "string" || typeof result.pollUrl !== "string")
        throw new Error("The server did not return an import job to track.");
      setActiveJob({
        pollUrl: result.pollUrl,
        value: {
          jobId: result.jobId,
          status: typeof result.status === "string" ? result.status : "queued",
          accepted: numberValue(result.accepted),
          remaining: numberValue(result.remaining),
          rows: Array.isArray(result.rows) ? result.rows : preview.rows,
        },
      });
      setConfirmed(false);
      setNotice("Your import is queued. Ludex will add only the matches you reviewed.");
      setPollVersion((current) => current + 1);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Connections" subtitle="Bring over a history you already love." refresh={refresh}>
      <Heading context="YOUR SOURCES · YOUR CALL" title="Bring your history with you." />
      {!ready ? (
        <Text style={local.muted}>Opening your account…</Text>
      ) : !session ? (
        <View style={local.signInCard}>
          <Text style={local.cardTitle}>Your sources stay private to your account.</Text>
          <Text style={local.muted}>Sign in to review captures, preview an import, or see past imports.</Text>
          <Button mode="contained" onPress={() => router.push("/auth")}>Sign in to continue</Button>
        </View>
      ) : (
        <>
          {error ? <InlineError message={error} onRetry={() => void refresh()} /> : null}
          <Text style={local.sectionLabel}>SOURCE AVAILABILITY</Text>
          <View style={local.sourceGrid}>
            <SourceCard name="CSV import" detail={overview?.capabilities.csv ? "Ready · preview before importing" : "Unavailable in this environment"} active={!!overview?.capabilities.csv} />
            <SourceCard name="Letterboxd" detail={overview?.capabilities.letterboxd ? "CSV export supported" : "Not configured"} active={!!overview?.capabilities.letterboxd} />
            <SourceCard
              name="Steam"
              detail={!steamConfigured ? "Steam API key is not configured" : !steamSupported ? "Steam preview is not supported here" : "Manual Steam ID preview · choose each game match"}
              active={steamConfigured && steamSupported}
            />
            <SourceCard name="Netflix capture" detail={overview?.capabilities.netflixCapture ? "Browser captures wait here for review" : "Not available"} active={!!overview?.capabilities.netflixCapture} />
            <SourceCard name="RetroAchievements" detail={overview?.capabilities.retroachievements ? "Connection available" : "Not supported yet"} active={!!overview?.capabilities.retroachievements} />
            <SourceCard name="Trakt" detail={overview?.capabilities.trakt ? "Connection available" : "Not supported yet"} active={!!overview?.capabilities.trakt} />
          </View>

          {loading && !overview ? <Text accessibilityLiveRegion="polite" style={local.muted}>Loading your private connections…</Text> : null}

          {overview ? (
            <>
              <View style={local.section}>
                <View style={local.sectionHeader}>
                  <View><Text style={local.sectionLabel}>INBOX</Text><Text style={local.sectionTitle}>Captures to review</Text></View>
                  <Text style={local.count}>{observations.length} waiting</Text>
                </View>
                {!observations.length ? <Text style={local.muted}>No new captures are waiting for review.</Text> : observations.map((item) => (
                  <ObservationReview key={item.id} item={item} catalog={catalog} onConfirm={(choice) => confirmObservation(item.id, choice)} />
                ))}
              </View>

              <View style={local.section}>
                <Text style={local.sectionLabel}>STEAM · MANUAL PREVIEW</Text>
                <Text style={local.sectionTitle}>Review game history</Text>
                {!steamConfigured ? (
                  <Text style={local.muted}>Steam preview is unavailable because this environment has no Steam API key configured.</Text>
                ) : !steamSupported ? (
                  <Text style={local.muted}>Steam preview is not supported in this environment yet.</Text>
                ) : (
                  <>
                    <Text style={local.muted}>Enter a public 17-digit Steam ID64. Nothing reaches your journal until you choose a Ludex game and confirm it.</Text>
                    <TextInput
                      mode="outlined"
                      label="Steam ID64"
                      value={steamId64}
                      onChangeText={(value) => {
                        const next = value.replace(/\D/g, "").slice(0, 17);
                        steamVersion.current++;
                        setSteamId64(next);
                        setSteamRows([]);
                        setSteamLoadedId("");
                        setSteamNextOffset(null);
                        setSteamError("");
                        setSteamBusy(false);
                      }}
                      keyboardType="number-pad"
                      maxLength={17}
                      placeholder="76561198012345678"
                      outlineColor={colors.outline}
                      activeOutlineColor={colors.coral}
                      textColor={colors.pearl}
                      placeholderTextColor={colors.muted}
                      style={local.csvInput}
                      contentStyle={local.inputContent}
                      disabled={steamBusy}
                    />
                    {steamError ? <InlineError message={steamError} onRetry={() => void previewSteam()} /> : null}
                    <Button mode="contained" onPress={() => void previewSteam()} disabled={steamId64.length !== 17 || steamBusy}>
                      {steamBusy ? "Loading games…" : "Preview Steam games"}
                    </Button>
                    {currentSteamRows.length ? currentSteamRows.map((row) => (
                      <SteamReview key={row.id} row={row} catalog={catalog} busy={steamBusy} onConfirm={(choice) => confirmObservation(row.id, choice, true)} />
                    )) : steamLoadedId === steamId64.trim() && steamLoadedId ? (
                      <Text style={local.muted}>No games were returned for this Steam account.</Text>
                    ) : null}
                    {steamNextOffset !== null ? (
                      <Button mode="outlined" onPress={() => void previewSteam(steamNextOffset)} disabled={steamBusy}>
                        {steamBusy ? "Loading…" : "Load next 100 games"}
                      </Button>
                    ) : null}
                  </>
                )}
              </View>

              <View style={local.section}>
                <Text style={local.sectionLabel}>PRIVATE IMPORT</Text>
                <Text style={local.sectionTitle}>Preview a CSV</Text>
                <Text style={local.muted}>Paste the export below. Ludex parses and matches it on the server; no journal entries are made by previewing.</Text>
                <View style={local.sourceSwitch} accessibilityRole="radiogroup" accessibilityLabel="CSV format">
                  {(["csv", "letterboxd"] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: source === value }}
                      onPress={() => setSource(value)}
                      style={[local.sourceChoice, source === value ? local.sourceChoiceSelected : null]}
                    >
                      <Text style={[local.sourceChoiceText, source === value ? local.sourceChoiceTextSelected : null]}>
                        {value === "csv" ? "Generic CSV" : "Letterboxd"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  mode="outlined"
                  label="Paste CSV text"
                  value={csv}
                  onChangeText={(text) => { setCsv(text); setPreview(null); setConfirmed(false); }}
                  multiline
                  numberOfLines={5}
                  maxLength={5 * 1024 * 1024}
                  placeholder={'title,year,media,date,rating\nMoonrise Kingdom,2012,movie,2026-09-12,8'}
                  outlineColor={colors.outline}
                  activeOutlineColor={colors.coral}
                  textColor={colors.pearl}
                  placeholderTextColor={colors.muted}
                  style={local.csvInput}
                  contentStyle={local.inputContent}
                  disabled={busy}
                />
                <Button mode="contained" onPress={() => void makePreview()} disabled={!csv.trim() || busy}>
                  {busy && !preview ? "Checking matches…" : "Preview matches"}
                </Button>
                {preview ? (
                  <View style={local.preview}>
                    <Text style={local.sectionTitle}>{matched.length} matched · {unmatched.length} need attention</Text>
                    {preview.rows.length ? preview.rows.map((row) => (
                      <PreviewRow key={row.id} row={row} />
                    )) : <Text style={local.muted}>No importable rows were found in this file.</Text>}
                    {matched.length ? (
                      <>
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: confirmed }}
                          onPress={() => setConfirmed((value) => !value)}
                          style={local.confirmLine}
                        >
                          <View style={[local.checkbox, confirmed ? local.checkboxChecked : null]}>
                            {confirmed ? <Text style={local.checkmark}>✓</Text> : null}
                          </View>
                          <Text style={local.confirmText}>I reviewed these matches. Add only matched rows to my private journal.</Text>
                        </Pressable>
                        <Button mode="contained" onPress={() => void commit()} disabled={!confirmed || busy}>
                          {busy ? "Queueing import…" : `Import all ${matched.length} matched rows`}
                        </Button>
                      </>
                    ) : <Text style={local.muted}>Nothing will be imported until a row has a safe match.</Text>}
                    {unmatched.length ? <Text style={local.muted}>Rows without a safe match stay out of your journal.</Text> : null}
                  </View>
                ) : null}
              </View>

              {activeJob ? (
                <View style={local.section}>
                  <Text style={local.sectionLabel}>IMPORT JOB</Text>
                  <Text style={local.sectionTitle}>{jobTitle(activeJob.value.status)}</Text>
                  <Text style={local.muted}>{activeJob.value.accepted} added · {activeJob.value.remaining} still unresolved</Text>
                  {activeJob.value.status === "queued" || activeJob.value.status === "running" ? <Text accessibilityLiveRegion="polite" style={local.working}>Working…</Text> : null}
                  {pollError ? <InlineError message={pollError} onRetry={() => setPollVersion((value) => value + 1)} retryLabel="Check status again" /> : null}
                  {activeJob.value.rows.map((row) => (
                    <View key={row.id} style={local.jobRow}>
                      <Text style={local.rowTitle}>{row.title}</Text>
                      <Text style={row.status === "accepted" || row.status === "completed" ? local.success : local.muted}>{row.outcome ?? row.status}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={local.section}>
                <Text style={local.sectionLabel}>HISTORY</Text>
                <Text style={local.sectionTitle}>Recent imports</Text>
                {!imports.length ? <Text style={local.muted}>Your import history will appear here.</Text> : imports.map((item) => (
                  <View key={item.id} style={local.historyRow}>
                    <View><Text style={local.rowTitle}>{item.source === "letterboxd" ? "Letterboxd" : "CSV"}</Text><Text style={local.muted}>{dateLabel(item.createdAt)}</Text></View>
                    <Text style={local.historyStatus}>{item.status}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}

function SourceCard({ name, detail, active }: { name: string; detail: string; active: boolean }) {
  return (
    <View style={[local.sourceCard, active ? local.sourceActive : null]}>
      <View style={[local.dot, active ? local.dotActive : null]} />
      <Text style={local.sourceName}>{name}</Text>
      <Text style={local.sourceDetail}>{detail}</Text>
    </View>
  );
}

function ObservationReview({
  item,
  catalog,
  onConfirm,
}: {
  item: ConnectionObservation;
  catalog: CatalogHit[];
  onConfirm: (choice: { titleId: string; media: "movie" | "show" | "game"; episodeId?: string }) => Promise<void>;
}) {
  const [media, setMedia] = useState<"movie" | "show" | "game">("movie");
  const [query, setQuery] = useState("");
  const [titleId, setTitleId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = catalog.filter((hit) => hit.media === media && hit.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5);
  const selected = catalog.find((hit) => hit.id === titleId);
  const title = typeof item.payload?.title === "string" ? item.payload.title : "Capture from Netflix";
  return (
    <View style={local.observation}>
      <View style={{ flex: 1 }}>
        <Text style={local.rowTitle}>{title}</Text>
        <Text style={local.muted}>{item.source === "netflix-extension" ? "Netflix capture" : item.source} · {dateLabel(item.observedAt)}</Text>
      </View>
      <Text style={local.reviewTag}>Review needed</Text>
      <Text style={local.observationNote}>This capture has not changed your journal. Choose the matching title to confirm it.</Text>
      <View style={local.choiceRow}>
        {(["movie", "show", "game"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: media === value }} onPress={() => { setMedia(value); setTitleId(""); setQuery(""); setEpisodeId(""); }} style={[local.sourceChoice, media === value ? local.sourceChoiceSelected : null]}>
            <Text style={[local.sourceChoiceText, media === value ? local.sourceChoiceTextSelected : null]}>{mediaName(value)}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput mode="outlined" label="Search Ludex catalog" value={query} onChangeText={(value) => { setQuery(value); setTitleId(""); setEpisodeId(""); }} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} placeholderTextColor={colors.muted} style={local.catalogInput} contentStyle={local.inputContent} />
      <CatalogChoices matches={matches} selectedId={titleId} onChoose={(hit) => setTitleId(hit.id)} />
      {media === "show" && selected ? (
        <View style={local.episodeChoices}>
          <Text style={local.muted}>Choose the episode to confirm</Text>
          {selected.episodes?.length ? selected.episodes.slice(0, 8).map((episode) => (
            <Pressable key={episode.id} accessibilityRole="radio" accessibilityState={{ selected: episodeId === episode.id }} onPress={() => setEpisodeId(episode.id)} style={[local.catalogChoice, episodeId === episode.id ? local.catalogChoiceSelected : null]}>
              <Text style={local.catalogChoiceTitle}>{episode.title || `Episode ${episode.order}`}</Text>
              <Text style={local.muted}>{episode.id}</Text>
            </Pressable>
          )) : <Text style={local.muted}>This catalog entry has no episode list. Choose another series with episodes.</Text>}
        </View>
      ) : null}
      {error ? <Text style={local.warning} accessibilityRole="alert">{error}</Text> : null}
      <Button mode="outlined" disabled={busy || !titleId || (media === "show" && !episodeId)} onPress={async () => {
        setBusy(true);
        setError("");
        try { await onConfirm({ titleId, media, ...(media === "show" ? { episodeId } : {}) }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "This capture could not be confirmed."); }
        finally { setBusy(false); }
      }}>{busy ? "Confirming…" : "Confirm capture"}</Button>
    </View>
  );
}

function SteamReview({
  row,
  catalog,
  busy,
  onConfirm,
}: {
  row: SteamPreviewObservation;
  catalog: CatalogHit[];
  busy: boolean;
  onConfirm: (choice: { titleId: string; media: "game" }) => Promise<void>;
}) {
  const [query, setQuery] = useState(row.title);
  const [titleId, setTitleId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const matches = catalog.filter((hit) => hit.media === "game" && hit.title.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5);
  return (
    <View style={local.steamRow}>
      <Text style={local.rowTitle}>{row.title} · {row.minutes.toLocaleString()} minutes</Text>
      <Text style={local.muted}>Steam App {row.appId} · choose the Ludex game that matches</Text>
      <TextInput mode="outlined" label="Search Ludex games" value={query} onChangeText={(value) => { setQuery(value); setTitleId(""); }} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} placeholderTextColor={colors.muted} style={local.catalogInput} contentStyle={local.inputContent} />
      <CatalogChoices matches={matches} selectedId={titleId} onChoose={(hit) => setTitleId(hit.id)} />
      {error ? <Text style={local.warning} accessibilityRole="alert">{error}</Text> : null}
      <Button mode="outlined" disabled={!titleId || busy || confirming} onPress={async () => {
        setConfirming(true);
        setError("");
        try { await onConfirm({ titleId, media: "game" }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "This game could not be confirmed."); }
        finally { setConfirming(false); }
      }}>{confirming ? "Confirming…" : "Add confirmed game"}</Button>
    </View>
  );
}

function CatalogChoices({
  matches,
  selectedId,
  onChoose,
}: {
  matches: CatalogHit[];
  selectedId: string;
  onChoose: (hit: CatalogHit) => void;
}) {
  return matches.length ? (
    <View style={local.catalogChoices} accessibilityRole="radiogroup" accessibilityLabel="Matching catalog titles">
      {matches.map((hit) => (
        <Pressable key={hit.id} accessibilityRole="radio" accessibilityState={{ selected: selectedId === hit.id }} onPress={() => onChoose(hit)} style={[local.catalogChoice, selectedId === hit.id ? local.catalogChoiceSelected : null]}>
          <Text style={local.catalogChoiceTitle}>{hit.title}{hit.year ? ` · ${hit.year}` : ""}</Text>
          <Text style={local.muted}>{mediaName(hit.media)} · tap to select</Text>
        </Pressable>
      ))}
    </View>
  ) : <Text style={local.muted}>No matching Ludex catalog titles. Search another title.</Text>;
}

function PreviewRow({ row }: { row: ImportPreview["rows"][number] }) {
  const matched = isMatched(row);
  return (
    <View style={local.previewRow}>
      <View style={{ flex: 1 }}>
        <Text style={local.rowTitle}>{row.title}</Text>
        <Text style={local.muted}>{mediaName(row.media)}{row.year ? ` · ${row.year}` : ""}{row.date ? ` · ${row.date}` : ""}</Text>
      </View>
      <Text style={matched ? local.success : local.warning}>{matched ? "Matched in Ludex" : "No safe match"}</Text>
    </View>
  );
}

function InlineError({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <View style={local.error} accessibilityRole="alert">
      <Text style={local.errorText}>{message}</Text>
      <Button compact onPress={onRetry}>{retryLabel}</Button>
    </View>
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isMatched(row: ImportPreview["rows"][number]) {
  return row.status === "matched" && typeof row.matchedTitleId === "string" && row.matchedTitleId.length > 0;
}

function mediaName(value: string) {
  return value === "show" ? "Series" : value === "game" ? "Game" : "Film";
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function jobTitle(status: string) {
  if (status === "queued" || status === "running") return "Import in progress";
  if (status === "completed") return "Import complete";
  if (status === "partial") return "Some rows need attention";
  return "Import could not complete";
}

function failureMessage(cause: unknown) {
  if (cause instanceof LudexError && (cause.status === 401 || cause.status === 403))
    return "Your session ended. Sign in again to continue.";
  return cause instanceof Error ? cause.message : "The connection is unavailable.";
}

const local = StyleSheet.create({
  signInCard: { gap: 11, padding: 15, borderWidth: 1, borderColor: colors.outline, borderRadius: 10, backgroundColor: colors.surface, marginBottom: 16 },
  cardTitle: { ...type.heading, color: colors.pearl, fontSize: 15 },
  muted: { ...type.body, color: colors.muted, fontSize: 11, lineHeight: 18 },
  sectionLabel: { ...type.metadata, color: colors.lime, fontSize: 9, letterSpacing: 1.2, marginBottom: 3 },
  sectionTitle: { ...type.heading, color: colors.pearl, fontSize: 15, marginBottom: 6 },
  sourceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  sourceCard: { width: "48%", minHeight: 93, padding: 11, borderWidth: 1, borderColor: colors.outline, borderRadius: 8, backgroundColor: colors.surface },
  sourceActive: { borderColor: "#80658b", backgroundColor: colors.raised },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.outline, marginBottom: 7 },
  dotActive: { backgroundColor: colors.lime },
  sourceName: { ...type.control, color: colors.pearl, fontSize: 10, marginBottom: 3 },
  sourceDetail: { ...type.body, color: colors.muted, fontSize: 9, lineHeight: 14 },
  section: { gap: 8, padding: 13, borderWidth: 1, borderColor: colors.outline, borderRadius: 9, backgroundColor: colors.surface, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  count: { ...type.metadata, color: colors.orchid, fontSize: 9 },
  observation: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 10, borderWidth: 1, borderColor: colors.outline, borderRadius: 6, backgroundColor: colors.raised },
  observationNote: { ...type.body, width: "100%", color: colors.muted, fontSize: 9 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, width: "100%" },
  catalogInput: { width: "100%", minHeight: 46, backgroundColor: colors.surface },
  catalogChoices: { width: "100%", gap: 5 },
  episodeChoices: { width: "100%", gap: 5, marginTop: 4 },
  catalogChoice: { padding: 9, borderWidth: 1, borderColor: colors.outline, borderRadius: 6, backgroundColor: colors.surface },
  catalogChoiceSelected: { borderColor: colors.lime, backgroundColor: colors.raised },
  catalogChoiceTitle: { ...type.control, color: colors.pearl, fontSize: 10, marginBottom: 3 },
  steamRow: { gap: 7, padding: 10, borderWidth: 1, borderColor: colors.outline, borderRadius: 7, backgroundColor: colors.raised },
  reviewTag: { ...type.metadata, color: "#F2D5A0", fontSize: 8, borderWidth: 1, borderColor: "#785d3e", borderRadius: 14, paddingHorizontal: 7, paddingVertical: 3 },
  sourceSwitch: { flexDirection: "row", gap: 7, marginVertical: 3 },
  sourceChoice: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.outline, borderRadius: 20 },
  sourceChoiceSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  sourceChoiceText: { ...type.control, color: colors.pearl, fontSize: 10 },
  sourceChoiceTextSelected: { color: colors.ink },
  csvInput: { minHeight: 125, backgroundColor: colors.raised },
  inputContent: { ...type.body, color: colors.pearl, fontSize: 11, lineHeight: 17 },
  preview: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.outline, marginTop: 6 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderWidth: 1, borderColor: colors.outline, borderRadius: 6, backgroundColor: colors.raised },
  rowTitle: { ...type.control, color: colors.pearl, fontSize: 10 },
  success: { ...type.metadata, color: colors.lime, fontSize: 9 },
  warning: { ...type.metadata, color: colors.error, fontSize: 9 },
  confirmLine: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 },
  checkbox: { width: 19, height: 19, borderWidth: 1, borderColor: colors.muted, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.lime, borderColor: colors.lime },
  checkmark: { ...type.heading, color: colors.ink, fontSize: 13, lineHeight: 16 },
  confirmText: { ...type.body, flex: 1, color: colors.pearl, fontSize: 10, lineHeight: 16 },
  working: { ...type.metadata, color: colors.lime, fontSize: 10 },
  jobRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.outline },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.outline },
  historyStatus: { ...type.metadata, color: colors.orchid, fontSize: 9, textTransform: "capitalize" },
  error: { gap: 6, padding: 10, borderWidth: 1, borderColor: colors.error, borderRadius: 7, backgroundColor: colors.raised, marginBottom: 12 },
  errorText: { ...type.body, color: colors.error, fontSize: 10, lineHeight: 16 },
});
