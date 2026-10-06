"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { LudexError } from "@ludex/client";
import type { CatalogHit } from "@ludex/domain";
import {
  createConnectionsClient,
  type ConnectionsRequest,
  type DiscussionScope,
  type PlanDiscussionMessage,
  type PlanDetail,
  type PlanSummary,
} from "../../packages/client/src/connections.ts";
import styles from "./Plans.module.css";

type Props = {
  client: ConnectionsRequest;
  signedIn: boolean;
  sessionKey: string | null;
  catalog?: CatalogHit[];
  onSignIn: () => void;
};

type ScopeKind = "none" | "episodes" | "milestone";

export function Plans(props: Props) {
  return <PlansContent key={props.sessionKey ?? "guest"} {...props} />;
}

function PlansContent({ client, signedIn, sessionKey, catalog = [], onSignIn }: Props) {
  const api = useMemo(() => createConnectionsClient(client), [client]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detailState, setDetailState] = useState<{ key: string; value: PlanDetail } | null>(null);
  const [discussionState, setDiscussionState] = useState<{ key: string; value: PlanDiscussionMessage[] } | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
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
  const [scopeKind, setScopeKind] = useState<ScopeKind>("none");
  const [scopeTitleId, setScopeTitleId] = useState("");
  const [scopeIds, setScopeIds] = useState("");
  const plansRequest = useRef(0);

  const refreshPlans = useCallback(async () => {
    if (!signedIn || !sessionKey) return false;
    const version = ++plansRequest.current;
    setLoading(true);
    setError("");
    try {
      const next = await api.readPlans();
      if (version !== plansRequest.current) return false;
      setPlans(next);
      setLoadedOwner(sessionKey);
      setSelectedId((current) => next.some((plan) => plan.id === current) ? current : next[0]?.id ?? "");
      return true;
    } catch (cause) {
      if (version === plansRequest.current) setError(errorText(cause, "Plans could not be loaded."));
      return false;
    } finally {
      if (version === plansRequest.current) setLoading(false);
    }
  }, [api, plansRequest, sessionKey, signedIn]);

  useEffect(() => {
    if (signedIn && sessionKey)
      void Promise.resolve().then(() => refreshPlans());
  }, [plansRequest, refreshPlans, sessionKey, signedIn]);

  useEffect(() => {
    if (!signedIn || !sessionKey || loadedOwner !== sessionKey || !selectedId) return;
    let active = true;
    const key = `${sessionKey}:${selectedId}`;
    void Promise.all([api.readPlan(selectedId), api.readDiscussion(selectedId)])
      .then(([nextDetail, nextDiscussion]) => {
        if (!active) return;
        setDetailState({ key, value: nextDetail });
        setDiscussionState({ key, value: nextDiscussion });
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, "This plan could not be opened."));
      });
    return () => {
      active = false;
    };
  }, [api, loadedOwner, selectedId, sessionKey, signedIn]);

  const currentOwner = signedIn && !!sessionKey && loadedOwner === sessionKey;
  const selectedPlan = currentOwner ? plans.find((plan) => plan.id === selectedId) : undefined;
  const selectedKey = `${sessionKey ?? "guest"}:${selectedId}`;
  const detail = detailState?.key === selectedKey ? detailState.value : null;
  const discussion = discussionState?.key === selectedKey ? discussionState.value : [];
  const titleMatches = catalog
    .filter((item) => `${item.title} ${item.year} ${item.media}`.toLowerCase().includes(candidateQuery.trim().toLowerCase()))
    .slice(0, 8);
  const scopeTitles = catalog.filter((item) =>
    scopeKind === "episodes" ? item.media === "show" : scopeKind === "milestone" ? item.media === "game" : false,
  );

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const ids = [...new Set(memberIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))]
      .filter((id) => id !== sessionKey);
    if (!cleanTitle || cleanTitle.length > 100) {
      setError("Give this plan a title between 1 and 100 characters.");
      return;
    }
    if (ids.length > 7) {
      setError("A plan can include up to seven invited members, plus you.");
      return;
    }
    let isoStart = "";
    if (startsAt) {
      const date = new Date(startsAt);
      if (Number.isNaN(date.getTime())) {
        setError("Choose a valid start time.");
        return;
      }
      isoStart = date.toISOString();
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

  async function addMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !message.trim() || saving) return;
    let scope: DiscussionScope;
    if (scopeKind === "none") {
      scope = { kind: "none" };
    } else {
      const ids = [...new Set(scopeIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))];
      if (!scopeTitleId || !ids.length) {
        setError(scopeKind === "episodes"
          ? "Choose a series and add at least one episode ID for this spoiler scope."
          : "Choose a game and add at least one milestone ID for this spoiler scope.");
        return;
      }
      scope = scopeKind === "episodes"
        ? { kind: "episodes", showId: scopeTitleId, requiredEpisodeIds: ids }
        : { kind: "milestone", gameId: scopeTitleId, requiredMilestoneIds: ids };
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.addDiscussion(selectedId, message.trim(), scope);
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
    <section className={styles.panel} aria-label="Shared plans">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MAKE IT A NIGHT</p>
          <h2>Plans worth leaving the sofa for.</h2>
          <p className={styles.intro}>Set a time, collect a shortlist, and keep story details in the right hands.</p>
        </div>
        {signedIn ? (
          <button className={styles.refresh} type="button" disabled={loading} onClick={() => void refreshPlans()} aria-label="Refresh plans">
            <ArrowClockwise size={15} aria-hidden="true" /> Refresh
          </button>
        ) : null}
      </header>

      {!signedIn ? (
        <div className={styles.signIn}>
          <strong>Shared plans belong to your account.</strong>
          <p>Sign in to create a plan, answer an invite, or talk with your group.</p>
          <button className={styles.primary} type="button" onClick={onSignIn}>Sign in to continue</button>
        </div>
      ) : (
        <>
          {error ? (
            <div className={styles.error} role="alert">
              <span>{error}</span>
              {error.includes("session ended") ? <button type="button" onClick={onSignIn}>Sign in again</button> : null}
              <button type="button" onClick={() => void refreshPlans()}>Refresh plans</button>
            </div>
          ) : null}
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {!currentOwner && loading ? <p className={styles.status} role="status">Loading your plans…</p> : null}

          {currentOwner ? (
            <div className={styles.workspace}>
              <aside className={styles.rail} aria-label="Your plan list">
                <div className={styles.railHeading}>
                  <span className={styles.eyebrow}>YOUR PLANS</span>
                  <span className={styles.planCount}>{plans.length}</span>
                </div>
                {!plans.length ? (
                  <p className={styles.emptyRail}>Nothing planned yet. Start with a title and a time.</p>
                ) : (
                  <div className={styles.planList}>
                    {plans.map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        className={`${styles.planButton} ${selectedId === plan.id ? styles.planSelected : ""}`}
                        onClick={() => { setSelectedId(plan.id); setNotice(""); }}
                        aria-current={selectedId === plan.id ? "page" : undefined}
                      >
                        <span className={styles.planDate}>{dateLabel(plan.startsAt)}</span>
                        <strong>{plan.title}</strong>
                        <span className={styles.planMeta}>{rsvpLabel(plan.rsvp)}</span>
                      </button>
                    ))}
                  </div>
                )}
                <form className={styles.createForm} onSubmit={createPlan}>
                  <p className={styles.eyebrow}>START SOMETHING</p>
                  <label className={styles.field}>
                    <span>Plan title</span>
                    <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={100} required placeholder="Friday double feature" />
                  </label>
                  <label className={styles.field}>
                    <span>Start time <small>optional</small></span>
                    <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.currentTarget.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Invite member IDs <small>optional, up to 7</small></span>
                    <textarea value={memberIds} onChange={(event) => setMemberIds(event.currentTarget.value)} rows={2} placeholder="Separate IDs with commas" />
                  </label>
                  <button className={styles.primary} type="submit" disabled={saving || !title.trim()}>
                    {saving ? "Saving…" : "Create plan"}
                  </button>
                </form>
              </aside>

              <div className={styles.detailColumn}>
                {selectedPlan && detail ? (
                  <>
                    <section className={styles.planHero} aria-labelledby="selected-plan-title">
                      <div className={styles.ticketMark} aria-hidden="true">L</div>
                      <div className={styles.planHeroText}>
                        <p className={styles.eyebrow}>{dateLabel(detail.startsAt)} · SHARED PLAN</p>
                        <h3 id="selected-plan-title">{detail.title}</h3>
                        <p>{detail.startsAt ? formatDateTime(detail.startsAt) : "Choose a time together."}</p>
                      </div>
                      <div className={styles.rsvp} role="group" aria-label="Your RSVP">
                        {(["yes", "maybe", "no"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={selectedPlan.rsvp === value ? styles.rsvpSelected : ""}
                            onClick={() => void changeRsvp(value)}
                            disabled={saving}
                            aria-pressed={selectedPlan.rsvp === value}
                          >
                            {value === "yes" ? "I’m in" : value[0].toUpperCase() + value.slice(1)}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className={styles.shortlist} aria-labelledby="shortlist-title">
                      <div className={styles.sectionHeading}>
                        <div><p className={styles.eyebrow}>THE RUNNING ORDER</p><h4 id="shortlist-title">Shortlist</h4></div>
                        <span className={styles.count}>{detail.candidates.length} / 12</span>
                      </div>
                      {!detail.candidates.length ? <p className={styles.empty}>No titles on the list yet. Add a possibility for the group.</p> : null}
                      <div className={styles.shortlistItems}>
                        {detail.candidates.map((candidate, index) => {
                          const hit = catalog.find((item) => item.id === candidate.titleId);
                          return (
                            <article key={candidate.titleId} className={styles.candidate}>
                              <span className={styles.candidateIndex}>{String(index + 1).padStart(2, "0")}</span>
                              <div><strong>{hit?.title ?? "Saved title"}</strong><span>{hit ? `${mediaLabel(hit.media)} · ${hit.year ?? "Year unknown"}` : "In the Ludex catalog"}</span></div>
                            </article>
                          );
                        })}
                      </div>
                      {detail.candidates.length < 12 ? (
                        <div className={styles.addTitle}>
                          {catalog.length ? (
                            <>
                              <label className={styles.field}>
                                <span>Find a title</span>
                                <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.currentTarget.value)} placeholder="Search your catalog" />
                              </label>
                              {candidateQuery.trim() ? (
                                <div className={styles.titleChoices} role="listbox" aria-label="Matching titles">
                                  {titleMatches.length ? titleMatches.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      role="option"
                                      aria-selected={candidateId === item.id}
                                      className={candidateId === item.id ? styles.titleSelected : ""}
                                      onClick={() => setCandidateId(item.id)}
                                    >
                                      <span>{item.title}</span><small>{mediaLabel(item.media)} · {item.year ?? "Year unknown"}</small>
                                    </button>
                                  )) : <p>No catalog matches. Try another title.</p>}
                                </div>
                              ) : <p className={styles.fieldHint}>Type a title to find something in the catalog.</p>}
                              <button className={styles.secondary} type="button" onClick={() => void addCandidate()} disabled={!candidateId || saving || detail.candidates.some((candidate) => candidate.titleId === candidateId)}>
                                {saving ? "Adding…" : "Add to shortlist"}
                              </button>
                            </>
                          ) : (
                            <p className={styles.fieldHint}>The catalog is still loading. Refresh this screen before adding titles.</p>
                          )}
                        </div>
                      ) : <p className={styles.fieldHint}>This shortlist is full. It can hold up to 12 titles.</p>}
                    </section>

                    <section className={styles.discussion} aria-labelledby="discussion-title">
                      <div className={styles.sectionHeading}>
                        <div><p className={styles.eyebrow}>KEEP THE CONVERSATION KIND</p><h4 id="discussion-title">Plan discussion</h4></div>
                      </div>
                      {!discussion.length ? <p className={styles.empty}>No messages yet. Share a thought with the group.</p> : null}
                      <div className={styles.messages} aria-live="polite">
                        {discussion.map((item) => <DiscussionCard key={item.id} message={item} sessionKey={sessionKey} />)}
                      </div>
                      <form className={styles.messageForm} onSubmit={addMessage}>
                        <label className={styles.field}>
                          <span>Your message</span>
                          <textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} maxLength={2000} rows={3} required placeholder="What should the group know?" />
                        </label>
                        <label className={styles.field}>
                          <span>Story detail</span>
                          <select
                            value={scopeKind}
                            onChange={(event) => {
                              const next = event.currentTarget.value as ScopeKind;
                              setScopeKind(next);
                              setScopeTitleId("");
                              setScopeIds("");
                            }}
                          >
                            <option value="none">No spoiler · everyone can read it</option>
                            <option value="episodes">Hide until episodes are watched</option>
                            <option value="milestone">Hide until a game milestone is reached</option>
                          </select>
                        </label>
                        {scopeKind !== "none" ? (
                          <div className={styles.scopeFields}>
                            <label className={styles.field}>
                              <span>{scopeKind === "episodes" ? "Series" : "Game"}</span>
                              <select value={scopeTitleId} onChange={(event) => setScopeTitleId(event.currentTarget.value)} required>
                                <option value="">Choose from the catalog</option>
                                {scopeTitles.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                              </select>
                            </label>
                            <label className={styles.field}>
                              <span>{scopeKind === "episodes" ? "Episode IDs required to reveal" : "Milestone IDs required to reveal"}</span>
                              <input value={scopeIds} onChange={(event) => setScopeIds(event.currentTarget.value)} placeholder="Separate IDs with commas" required />
                            </label>
                            <p className={styles.fieldHint}>Ludex hides your message from members until each required item is in their progress.</p>
                          </div>
                        ) : null}
                        <button className={styles.secondary} type="submit" disabled={saving || !message.trim()}>
                          {saving ? "Sharing…" : "Post to discussion"}
                        </button>
                      </form>
                    </section>
                  </>
                ) : plans.length ? (
                  <div className={styles.detailEmpty} role="status">{loading ? "Opening plan…" : "Choose a plan to see its shortlist and discussion."}</div>
                ) : (
                  <div className={styles.detailEmpty}>
                    <span className={styles.emptyGlyph} aria-hidden="true">✳</span>
                    <h3>A good night starts with one idea.</h3>
                    <p>Create a plan with a title. You can set the time later and let invitees answer when they arrive.</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function DiscussionCard({ message, sessionKey }: { message: PlanDiscussionMessage; sessionKey: string | null }) {
  const hidden = message.detailHidden === true || typeof message.text !== "string";
  return (
    <article className={styles.messageCard}>
      <div className={styles.messageMeta}>
        <strong>{message.authorId === sessionKey ? "You" : "Plan member"}</strong>
        <time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time>
      </div>
      {hidden ? (
        <p className={styles.hiddenText}>Story detail hidden until your progress unlocks it.</p>
      ) : (
        <>
          <p className={styles.messageText}>{message.text}</p>
          {message.scope?.kind !== "none" ? <span className={styles.spoilerTag}>Progress scoped</span> : null}
        </>
      )}
    </article>
  );
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof LudexError && (cause.status === 401 || cause.status === 403))
    return "Your session ended. Sign in again to continue.";
  return cause instanceof Error ? cause.message : fallback;
}

function dateLabel(value?: string | null) {
  if (!value) return "DATE TO BE DECIDED";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "DATE TO BE DECIDED"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date).toUpperCase();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time to be decided"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(date);
}

function rsvpLabel(value: string) {
  if (value === "yes") return "You’re in";
  if (value === "no") return "Not going";
  if (value === "maybe") return "Maybe";
  return "Awaiting RSVP";
}

function mediaLabel(media: string) {
  if (media === "show") return "Series";
  if (media === "game") return "Game";
  return "Film";
}
