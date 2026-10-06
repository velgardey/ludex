import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Button, Text, TextInput } from "react-native-paper";
import { LudexError } from "@ludex/client";
import type { CatalogHit } from "@ludex/domain";
import {
  createConnectionsClient,
  type DiscussionScope,
  type PlanDiscussionMessage,
  type PlanDetail,
  type PlanSummary,
} from "../../../../packages/client/src/connections.ts";
import { useLudex } from "../state";
import { Heading, Page } from "../ui";
import { colors, type } from "../theme";

export default function PlansScreen() {
  const { client, ready, session, catalog } = useLudex();
  return <PlansContent key={session?.user.id ?? "guest"} client={client} ready={ready} userId={session?.user.id ?? null} catalog={catalog} />;
}

function PlansContent({
  client,
  ready,
  userId,
  catalog,
}: {
  client: ReturnType<typeof useLudex>["client"];
  ready: boolean;
  userId: string | null;
  catalog: CatalogHit[];
}) {
  const api = useMemo(() => createConnectionsClient(client), [client]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<{ key: string; value: PlanDetail } | null>(null);
  const [discussionState, setDiscussionState] = useState<{ key: string; value: PlanDiscussionMessage[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [memberIds, setMemberIds] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [message, setMessage] = useState("");
  const [scopeKind, setScopeKind] = useState<"none" | "episodes" | "milestone">("none");
  const [scopeTitleId, setScopeTitleId] = useState("");
  const [scopeIds, setScopeIds] = useState("");
  const listVersion = useRef(0);

  const refreshPlans = useCallback(async () => {
    if (!ready || !userId) return false;
    const current = ++listVersion.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.readPlans();
      if (current !== listVersion.current) return false;
      setPlans(result);
      setLoadedOwner(userId);
      setSelectedId((existing) => result.some((plan) => plan.id === existing) ? existing : result[0]?.id ?? "");
      return true;
    } catch (cause) {
      if (current === listVersion.current) setError(errorText(cause, "Plans could not be loaded."));
      return false;
    } finally {
      if (current === listVersion.current) setLoading(false);
    }
  }, [api, ready, userId]);

  useEffect(() => {
    if (ready && userId) void refreshPlans();
    return () => { listVersion.current++; };
  }, [ready, refreshPlans, userId]);

  useEffect(() => {
    if (!ready || !userId || loadedOwner !== userId || !selectedId) return;
    let active = true;
    const key = `${userId}:${selectedId}`;
    void Promise.all([api.readPlan(selectedId), api.readDiscussion(selectedId)])
      .then(([detail, discussion]) => {
        if (!active) return;
        setDetailState({ key, value: detail });
        setDiscussionState({ key, value: discussion });
      })
      .catch((cause: unknown) => { if (active) setError(errorText(cause, "This plan could not be opened.")); });
    return () => { active = false; };
  }, [api, loadedOwner, ready, selectedId, userId]);

  const selectedKey = `${userId ?? "guest"}:${selectedId}`;
  const detail = detailState?.key === selectedKey ? detailState.value : null;
  const discussion = discussionState?.key === selectedKey ? discussionState.value : [];
  const selectedPlan = loadedOwner === userId ? plans.find((plan) => plan.id === selectedId) : undefined;
  const titleMatches = catalog
    .filter((item) => `${item.title} ${item.year ?? ""} ${item.media}`.toLowerCase().includes(candidateQuery.trim().toLowerCase()))
    .slice(0, 6);
  const scopeTitles = catalog.filter((item) => scopeKind === "episodes" ? item.media === "show" : scopeKind === "milestone" ? item.media === "game" : false);
  const currentOwner = !!userId && loadedOwner === userId;

  async function createPlan() {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 100) {
      setError("Give this plan a title between 1 and 100 characters.");
      return;
    }
    const ids = [...new Set(memberIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))].filter((id) => id !== userId);
    if (ids.length > 7) {
      setError("A plan can include up to seven invited members, plus you.");
      return;
    }
    let isoStart = "";
    if (startsAt.trim()) {
      const parsed = new Date(startsAt.trim());
      if (Number.isNaN(parsed.getTime())) {
        setError("Enter a valid ISO 8601 date and time, or leave the field blank.");
        return;
      }
      isoStart = parsed.toISOString();
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await api.createPlan({ title: cleanTitle, memberIds: ids, startsAt: isoStart });
      setTitle("");
      setMemberIds("");
      setStartsAt("");
      setSelectedId(created.id);
      await refreshPlans();
      setSelectedId(created.id);
      setNotice("Plan created. Invitees can RSVP when they open it.");
    } catch (cause) {
      setError(errorText(cause, "The plan could not be created."));
    } finally {
      setSaving(false);
    }
  }

  async function changeRsvp(value: "yes" | "no" | "maybe") {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.setRsvp(selectedId, value);
      setPlans((current) => current.map((plan) => plan.id === selectedId ? { ...plan, rsvp: value } : plan));
      setNotice(value === "yes" ? "You’re in." : value === "no" ? "Your RSVP is no." : "Your RSVP is maybe.");
    } catch (cause) {
      setError(errorText(cause, "Your RSVP could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function addCandidate() {
    if (!selectedId || !candidateId || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.addShortlist(selectedId, candidateId);
      const next = await api.readPlan(selectedId);
      setDetailState({ key: selectedKey, value: next });
      setCandidateId("");
      setCandidateQuery("");
      setNotice("Added to the shortlist.");
    } catch (cause) {
      setError(errorText(cause, "This title could not be added."));
    } finally {
      setSaving(false);
    }
  }

  async function addDiscussion() {
    const cleanMessage = message.trim();
    if (!selectedId || !cleanMessage || saving) return;
    let scope: DiscussionScope;
    if (scopeKind === "none") {
      scope = { kind: "none" };
    } else {
      const ids = [...new Set(scopeIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))];
      if (!scopeTitleId || !ids.length) {
        setError(scopeKind === "episodes" ? "Choose a series and episode ID for this spoiler scope." : "Choose a game and milestone ID for this spoiler scope.");
        return;
      }
      if (scopeKind === "episodes") {
        const selected = catalog.find((item) => item.id === scopeTitleId);
        if (selected?.episodes?.length && ids.some((id) => !selected.episodes?.some((episode) => episode.id === id))) {
          setError("Choose episode IDs from the selected series.");
          return;
        }
        scope = { kind: "episodes", showId: scopeTitleId, requiredEpisodeIds: ids };
      } else {
        scope = { kind: "milestone", gameId: scopeTitleId, requiredMilestoneIds: ids };
      }
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.addDiscussion(selectedId, cleanMessage, scope);
      setMessage("");
      const next = await api.readDiscussion(selectedId);
      setDiscussionState({ key: selectedKey, value: next });
      setNotice("Message shared with the plan.");
    } catch (cause) {
      setError(errorText(cause, "The message could not be posted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Shared plans" subtitle="Set a time, collect ideas, and keep story details in the right hands." refresh={async () => { await refreshPlans(); }}>
      <Heading context="MAKE IT A NIGHT" title="Plans worth leaving the sofa for." />
      {!ready ? <Text style={local.muted}>Opening your account…</Text> : !userId ? (
        <View style={local.card}>
          <Text style={local.title}>Shared plans belong to your account.</Text>
          <Text style={local.muted}>Sign in to create a plan, answer an invite, or talk with your group.</Text>
          <Button mode="contained" onPress={() => router.push("/auth")}>Sign in to continue</Button>
        </View>
      ) : (
        <>
          {error ? <View style={local.error}><Text style={local.errorText}>{error}</Text><Button compact onPress={() => void refreshPlans()}>Refresh plans</Button></View> : null}
          {notice ? <Text style={local.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
          {!currentOwner && loading ? <Text style={local.muted} accessibilityLiveRegion="polite">Loading your plans…</Text> : null}
          {currentOwner ? (
            <>
              <View style={local.card}>
                <Text style={local.sectionLabel}>YOUR PLANS · {plans.length}</Text>
                {!plans.length ? <Text style={local.muted}>Nothing planned yet. Start with a title and a time.</Text> : plans.map((plan) => (
                  <Pressable key={plan.id} onPress={() => { setSelectedId(plan.id); setNotice(""); }} accessibilityRole="button" accessibilityState={{ selected: selectedId === plan.id }} style={[local.planRow, selectedId === plan.id ? local.selectedRow : null]}>
                    <View style={{ flex: 1 }}><Text style={local.metadata}>{dateLabel(plan.startsAt)}</Text><Text style={local.rowTitle}>{plan.title}</Text></View>
                    <Text style={local.metadata}>{rsvpLabel(plan.rsvp)}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={local.card}>
                <Text style={local.sectionLabel}>START SOMETHING</Text>
                <TextInput mode="outlined" label="Plan title" value={title} onChangeText={setTitle} maxLength={100} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} style={local.input} />
                <TextInput mode="outlined" label="Start time · ISO 8601 · optional" value={startsAt} onChangeText={setStartsAt} placeholder="2026-10-09T18:30:00+05:30" outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} placeholderTextColor={colors.muted} style={local.input} />
                <TextInput mode="outlined" label="Invite member IDs · up to 7, comma-separated" value={memberIds} onChangeText={setMemberIds} multiline outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} placeholderTextColor={colors.muted} style={local.input} />
                <Button mode="contained" disabled={saving || !title.trim()} onPress={() => void createPlan()}>{saving ? "Saving…" : "Create plan"}</Button>
              </View>

              {selectedPlan ? detail ? (
                <>
                  <View style={local.hero}>
                    <Text style={local.sectionLabel}>{dateLabel(detail.startsAt)} · SHARED PLAN</Text>
                    <Text style={local.heroTitle}>{detail.title}</Text>
                    <Text style={local.muted}>{detail.startsAt ? formatDateTime(detail.startsAt) : "Choose a time together."}</Text>
                    <View style={local.choiceRow}>
                      {(["yes", "maybe", "no"] as const).map((value) => (
                        <Button key={value} mode={selectedPlan.rsvp === value ? "contained" : "outlined"} compact onPress={() => void changeRsvp(value)} disabled={saving}>{value === "yes" ? "I’m in" : value[0].toUpperCase() + value.slice(1)}</Button>
                      ))}
                    </View>
                  </View>
                  <View style={local.card}>
                    <Text style={local.sectionLabel}>THE RUNNING ORDER · {detail.candidates.length} / 12</Text>
                    {!detail.candidates.length ? <Text style={local.muted}>No titles on the list yet. Add a possibility for the group.</Text> : detail.candidates.map((candidate, index) => {
                      const hit = catalog.find((item) => item.id === candidate.titleId);
                      return <View key={candidate.titleId} style={local.candidate}><Text style={local.metadata}>{String(index + 1).padStart(2, "0")}</Text><View style={{ flex: 1 }}><Text style={local.rowTitle}>{hit?.title ?? "Saved title"}</Text><Text style={local.muted}>{hit ? `${mediaLabel(hit.media)} · ${hit.year ?? "Year unknown"}` : "In the Ludex catalog"}</Text></View></View>;
                    })}
                    {detail.candidates.length < 12 ? (
                      <>
                        <TextInput mode="outlined" label="Find a catalog title" value={candidateQuery} onChangeText={(value) => { setCandidateQuery(value); setCandidateId(""); }} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} style={local.input} />
                        {candidateQuery.trim() ? titleMatches.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: candidateId === item.id }} onPress={() => setCandidateId(item.id)} style={[local.catalogChoice, candidateId === item.id ? local.selectedRow : null]}><Text style={local.rowTitle}>{item.title}</Text><Text style={local.muted}>{mediaLabel(item.media)} · {item.year ?? "Year unknown"}</Text></Pressable>) : <Text style={local.muted}>Type a title to find something in the catalog.</Text>}
                        <Button mode="outlined" onPress={() => void addCandidate()} disabled={!candidateId || saving || detail.candidates.some((item) => item.titleId === candidateId)}>{saving ? "Adding…" : "Add to shortlist"}</Button>
                      </>
                    ) : <Text style={local.muted}>This shortlist is full. It can hold up to 12 titles.</Text>}
                  </View>
                  <View style={local.card}>
                    <Text style={local.sectionLabel}>PLAN DISCUSSION</Text>
                    {!discussion.length ? <Text style={local.muted}>No messages yet. Share a thought with the group.</Text> : discussion.map((item) => <DiscussionCard key={item.id} message={item} userId={userId} />)}
                    <TextInput mode="outlined" label="Your message" value={message} onChangeText={setMessage} multiline maxLength={2000} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} style={local.input} />
                    <Text style={local.muted}>Story detail</Text>
                    <View style={local.choiceRow}>
                      {(["none", "episodes", "milestone"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: scopeKind === value }} onPress={() => { setScopeKind(value); setScopeTitleId(""); setScopeIds(""); }} style={[local.sourceChoice, scopeKind === value ? local.sourceChoiceSelected : null]}><Text style={[local.sourceChoiceText, scopeKind === value ? local.sourceChoiceTextSelected : null]}>{value === "none" ? "No spoiler" : value === "episodes" ? "Series episodes" : "Game milestones"}</Text></Pressable>)}
                    </View>
                    {scopeKind !== "none" ? (
                      <>
                        <Text style={local.muted}>Choose a {scopeKind === "episodes" ? "series" : "game"} from the catalog</Text>
                        {scopeTitles.slice(0, 8).map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: scopeTitleId === item.id }} onPress={() => { setScopeTitleId(item.id); setScopeIds(""); }} style={[local.catalogChoice, scopeTitleId === item.id ? local.selectedRow : null]}><Text style={local.rowTitle}>{item.title}</Text><Text style={local.muted}>{mediaLabel(item.media)}</Text></Pressable>)}
                        {scopeKind === "episodes" && scopeTitleId ? (() => {
                          const series = catalog.find((item) => item.id === scopeTitleId);
                          return series?.episodes?.length ? <View style={local.episodeList}>{series.episodes.slice(0, 12).map((episode) => {
                            const selected = scopeIds.split(/[\n,]+/).includes(episode.id);
                            return <Pressable key={episode.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setScopeIds((current) => {
                              const values = current.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean);
                              return (selected ? values.filter((id) => id !== episode.id) : [...values, episode.id]).join(", ");
                            })} style={[local.catalogChoice, selected ? local.selectedRow : null]}><Text style={local.rowTitle}>{episode.title || `Episode ${episode.order}`}</Text><Text style={local.muted}>{episode.id}</Text></Pressable>;
                          })}</View> : <Text style={local.muted}>This series has no catalog episode list available.</Text>;
                        })() : null}
                        {scopeKind === "milestone" ? <TextInput mode="outlined" label="Required milestone IDs · comma-separated" value={scopeIds} onChangeText={setScopeIds} outlineColor={colors.outline} activeOutlineColor={colors.coral} textColor={colors.pearl} style={local.input} /> : null}
                        <Text style={local.muted}>Ludex hides your message from members until each required item is in their progress.</Text>
                      </>
                    ) : null}
                    <Button mode="contained" onPress={() => void addDiscussion()} disabled={saving || !message.trim()}>{saving ? "Sharing…" : "Post to discussion"}</Button>
                  </View>
                </>
              ) : <View style={local.card}><Text style={local.muted} accessibilityLiveRegion="polite">Opening plan…</Text></View> : null}
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}

function DiscussionCard({ message, userId }: { message: PlanDiscussionMessage; userId: string }) {
  const hidden = message.detailHidden === true || typeof message.text !== "string";
  return (
    <View style={local.messageCard}>
      <View style={local.messageMeta}><Text style={local.sectionLabel}>{message.authorId === userId ? "YOU" : "PLAN MEMBER"}</Text><Text style={local.metadata}>{dateLabel(message.createdAt)}</Text></View>
      {hidden ? <Text style={local.hidden}>Story detail hidden until your progress unlocks it.</Text> : <><Text style={local.messageText}>{message.text}</Text>{message.scope?.kind !== "none" ? <Text style={local.metadata}>Progress scoped</Text> : null}</>}
    </View>
  );
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof LudexError && (cause.status === 401 || cause.status === 403)) return "Your session ended. Sign in again to continue.";
  return cause instanceof Error ? cause.message : fallback;
}

function dateLabel(value?: string | null) {
  if (!value) return "DATE TO BE DECIDED";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "DATE TO BE DECIDED" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date).toUpperCase();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time to be decided" : new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(date);
}

function rsvpLabel(value: string) {
  if (value === "yes") return "You’re in";
  if (value === "no") return "Not going";
  if (value === "maybe") return "Maybe";
  return "Awaiting RSVP";
}

function mediaLabel(value: string) {
  if (value === "show") return "Series";
  if (value === "game") return "Game";
  return "Film";
}

const local = StyleSheet.create({
  muted: { ...type.body, color: colors.muted, fontSize: 11, lineHeight: 18 },
  metadata: { ...type.metadata, color: colors.orchid, fontSize: 9 },
  sectionLabel: { ...type.metadata, color: colors.lime, fontSize: 9, letterSpacing: 1.1, marginBottom: 3 },
  title: { ...type.heading, color: colors.pearl, fontSize: 15 },
  rowTitle: { ...type.control, color: colors.pearl, fontSize: 11 },
  card: { gap: 9, padding: 13, borderWidth: 1, borderColor: colors.outline, borderRadius: 9, backgroundColor: colors.surface, marginBottom: 12 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderWidth: 1, borderColor: colors.outline, borderRadius: 7, backgroundColor: colors.raised },
  selectedRow: { borderColor: colors.lime, backgroundColor: "#302938" },
  input: { minHeight: 48, backgroundColor: colors.surface },
  hero: { gap: 8, padding: 14, borderWidth: 1, borderColor: "#80658b", borderRadius: 10, backgroundColor: colors.raised, marginBottom: 12 },
  heroTitle: { ...type.title, color: colors.pearl, fontSize: 20 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  candidate: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.outline },
  catalogChoice: { padding: 9, borderWidth: 1, borderColor: colors.outline, borderRadius: 6, backgroundColor: colors.raised },
  sourceChoice: { minHeight: 36, justifyContent: "center", paddingHorizontal: 11, borderWidth: 1, borderColor: colors.outline, borderRadius: 20 },
  sourceChoiceSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  sourceChoiceText: { ...type.control, color: colors.pearl, fontSize: 9 },
  sourceChoiceTextSelected: { color: colors.ink },
  episodeList: { gap: 5, maxHeight: 240 },
  messageCard: { gap: 7, padding: 11, borderWidth: 1, borderColor: colors.outline, borderRadius: 7, backgroundColor: colors.raised },
  messageMeta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  messageText: { ...type.body, color: colors.pearl, fontSize: 11, lineHeight: 18 },
  hidden: { ...type.body, color: "#E7D5A6", fontSize: 10, lineHeight: 16 },
  error: { gap: 6, padding: 10, borderWidth: 1, borderColor: colors.error, borderRadius: 7, backgroundColor: colors.surface, marginBottom: 10 },
  errorText: { ...type.body, color: colors.error, fontSize: 10, lineHeight: 16 },
  notice: { ...type.metadata, color: colors.lime, fontSize: 10, marginBottom: 10 },
});
