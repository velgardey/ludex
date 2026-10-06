"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, Check, LinkSimple, Sparkle, X } from "@phosphor-icons/react";
import { LudexError } from "@ludex/client";
import {
  createAssistantClient,
  type AssistantAction,
  type AssistantMessage,
  type AssistantRequest,
  type AssistantState,
} from "../../packages/client/src/assistant.ts";
import styles from "./Companion.module.css";

const starterPrompts = [
  "Find a clever heist film",
  "Show me a short game",
  "Search for a time-loop story",
];

export function Companion({
  client,
  signedIn,
  sessionKey,
  onSignIn,
  onTitle,
  onConfirmed,
}: {
  client: AssistantRequest;
  signedIn: boolean;
  sessionKey: string | null;
  onSignIn: () => void;
  onTitle: (titleId: string) => void;
  onConfirmed: () => Promise<void>;
}) {
  const assistant = useMemo(() => createAssistantClient(client), [client]);
  const [state, setState] = useState<AssistantState | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [authExpired, setAuthExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);

  const refreshState = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const next = await assistant.readState();
      if (version === requestVersion.current) {
        setState(next);
        setLoadError("");
        setAuthExpired(false);
      }
      return version === requestVersion.current;
    } catch (error) {
      if (version === requestVersion.current) {
        setLoadError(errorText(error, "Your conversation could not be loaded."));
        setAuthExpired(isAuthError(error));
      }
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [assistant]);

  useEffect(() => {
    requestVersion.current++;
    const currentRequest = requestVersion;
    let active = true;
    if (signedIn)
      void Promise.resolve().then(() => {
        if (active) return refreshState();
      });
    return () => {
      active = false;
      currentRequest.current++;
    };
  }, [refreshState, sessionKey, signedIn]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
  }, [state?.messages, loading, sending]);

  const messages = Array.isArray(state?.messages) ? state.messages : [];
  const remaining = state?.allowance?.remaining;
  const exhausted =
    state?.status === "allowance-exhausted" ||
    state?.status === "disabled" ||
    (typeof remaining === "number" && remaining <= 0);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!signedIn || !text || sending || exhausted) return;

    setLoadError("");
    setAuthExpired(false);
    setNotice("");
    setSending(true);
    try {
      const result = await assistant.sendMessage(text, crypto.randomUUID());
      const resultStatus = objectValue(result)?.status;
      if (
        resultStatus === "rejected" ||
        resultStatus === "conflict" ||
        resultStatus === "allowance-exhausted"
      ) {
        await refreshState();
        setLoadError(resultMessage(result, "Your assistant allowance is used for now. Your journal has not changed."));
        setAuthExpired(false);
        return;
      }

      setDraft("");
      if (!(await refreshState()))
        setNotice(
          "Your message was sent, but the saved conversation could not refresh. Use Refresh to check for the reply.",
        );
    } catch (error) {
      setLoadError(errorText(error, "Your message could not be sent."));
      setAuthExpired(isAuthError(error));
    } finally {
      setSending(false);
    }
  }

  async function decide(action: AssistantAction, decision: "confirm" | "reject") {
    setBusyAction(action.id);
    setLoadError("");
    setAuthExpired(false);
    setNotice("");
    try {
      const result =
        decision === "confirm"
          ? await assistant.confirmAction(action.id)
          : await assistant.rejectAction(action.id);
      const resultStatus = objectValue(result)?.status;
      if (resultStatus === "rejected" || resultStatus === "conflict") {
        await refreshState();
        setLoadError(resultMessage(result, "That action was not accepted. Your journal has not changed."));
        setAuthExpired(false);
        return;
      }
      if (resultStatus === "pending") {
        await refreshState();
        setNotice("That action is still pending. Your journal has not changed yet.");
        return;
      }

      if (decision === "confirm" && resultStatus === "confirmed") {
        try {
          await onConfirmed();
        } catch {
          setNotice("Action confirmed. Your conversation is refreshed, but the library could not reload.");
          await refreshState();
          return;
        }
      }

      setNotice(
        decision === "confirm"
          ? "Confirmed. Refreshing your journal…"
          : "Dismissed. Refreshing your conversation…",
      );
      if (await refreshState())
        setNotice(decision === "confirm" ? "Your journal is up to date." : "Suggestion dismissed.");
    } catch (error) {
      await refreshState();
      setLoadError(errorText(error, "That action could not be completed."));
      setAuthExpired(isAuthError(error));
    } finally {
      setBusyAction(null);
    }
  }

  function insertPrompt(prompt: string) {
    setDraft(prompt);
    inputRef.current?.focus();
  }

  return (
    <section className={styles.shell} aria-label="Ludex companion">
      <div className={styles.statusLine}>
        <span role="status" aria-live="polite">
          {!signedIn
            ? "Sign in to open your private conversation"
            : loading && !state
              ? "Loading your saved conversation…"
              : state?.status === "unconfigured"
                ? "AI generation is off · catalog fallback available"
                : state?.status === "disabled"
                  ? "The companion is temporarily unavailable"
                  : exhausted
                    ? "Your assistant allowance is used for now"
                    : state
                      ? "Your conversation is saved to your Ludex account"
                      : "Waiting for your conversation"}
        </span>
        {signedIn && state ? (
          <span className={styles.allowance}>
            {state.allowance && Number.isFinite(state.allowance.remaining)
              ? `${Math.max(0, state.allowance.remaining)}${Number.isFinite(state.allowance.limit) ? ` of ${state.allowance.limit}` : ""} left`
              : "Usage details unavailable"}
          </span>
        ) : null}
        {signedIn ? (
          <button
            className={styles.refreshButton}
            type="button"
            aria-label="Refresh saved conversation"
            disabled={loading || sending || busyAction !== null}
            onClick={() => void refreshState()}
          >
            <ArrowClockwise size={14} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        ) : null}
      </div>

      {state?.status === "unconfigured" ? (
        <div className={styles.notice} role="status">
          <strong>Catalog fallback</strong>
          Azure AI is not configured for this environment. Catalog searches can still return deterministic matches; those replies are marked and will not be presented as AI-generated.
        </div>
      ) : null}
      {state && exhausted && state.status !== "disabled" ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">
          <strong>Allowance reached</strong>
          You can read this saved conversation. Sending new requests is paused until your allowance refreshes. Pending actions still require your review.
        </div>
      ) : null}
      {state?.status === "disabled" ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">
          <strong>Unavailable</strong>
          The assistant service is not accepting requests right now. Your saved messages are still available below.
        </div>
      ) : null}

      {signedIn ? (
        <>
          <div
            className={styles.thread}
            ref={threadRef}
            role="log"
            aria-label="Saved conversation"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={loading || sending}
          >
            {loading && !state ? (
              <p className={styles.pendingLine} role="status">
                Opening your saved conversation…
              </p>
            ) : null}
            {state && messages.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyMark} aria-hidden="true">
                  <Sparkle size={17} />
                </span>
                <h3>A quiet place to begin.</h3>
                <p>
                  Ask for a film, series, or game. Any change to your journal will wait for your confirmation.
                </p>
                <div className={styles.prompts} aria-label="Example searches">
                  {starterPrompts.map((prompt) => (
                    <button
                      className={styles.prompt}
                      key={prompt}
                      type="button"
                      onClick={() => insertPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onDecide={decide}
                onTitle={onTitle}
                busyAction={busyAction}
              />
            ))}
            {sending ? (
              <p className={styles.pendingLine} role="status">
                Sending your question…
              </p>
            ) : null}
            {notice ? <p className={styles.pendingLine} role="status">{notice}</p> : null}
            {loadError ? (
              <div className={styles.error} role="alert">
                {loadError}
                {!sending ? (
                  <button
                    type="button"
                    onClick={authExpired ? onSignIn : () => void refreshState()}
                  >
                    {authExpired ? "Sign in again" : "Refresh conversation"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <form className={styles.composer} onSubmit={send}>
            <label className={styles.srOnly} htmlFor="companion-prompt">
              Ask your Ludex companion
            </label>
            <textarea
              className={styles.input}
              id="companion-prompt"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                exhausted
                  ? "Your allowance is paused"
                  : "Ask about what to watch or play…"
              }
              maxLength={1000}
              rows={1}
              disabled={loading || sending || exhausted || !state}
              aria-describedby="companion-input-hint"
            />
            <button
              className={styles.send}
              type="submit"
              disabled={!draft.trim() || loading || sending || exhausted || !state}
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <span className={styles.srOnly} id="companion-input-hint">
              Press Enter to send. Press Shift and Enter for a new line. Your chat is saved to your account.
            </span>
          </form>
        </>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyMark} aria-hidden="true">
            <Sparkle size={17} />
          </span>
          <h3>Your conversation stays with your journal.</h3>
          <p>Sign in to load your saved messages and continue privately.</p>
          <button className={`${styles.send} ${styles.signIn}`} type="button" onClick={onSignIn}>
            Sign in to continue
          </button>
        </div>
      )}

    </section>
  );
}

function Message({
  message,
  onDecide,
  onTitle,
  busyAction,
}: {
  message: AssistantMessage;
  onDecide: (action: AssistantAction, decision: "confirm" | "reject") => void;
  onTitle: (titleId: string) => void;
  busyAction: string | null;
}) {
  const user = message.role === "user";
  const citations = Array.isArray(message.citations) ? message.citations : [];
  const actions = Array.isArray(message.actions) ? message.actions : [];
  const date = new Date(message.createdAt);
  const timeLabel = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);

  return (
    <article className={`${styles.message} ${user ? styles.messageUser : ""}`}>
      <div className={styles.messageMeta}>
        <span>{user ? "You" : "Ludex companion"}</span>
        {timeLabel ? <time dateTime={message.createdAt}>{timeLabel}</time> : null}
        {!user && message.fallback ? (
          <span className={styles.fallbackLabel}>Catalog fallback · no AI</span>
        ) : null}
      </div>
      <p className={styles.bubble}>{message.text}</p>

      {citations.length ? (
        <div className={styles.citations} aria-label="Sources">
          <span className={styles.citationHeading}>Sources</span>
          {citations.map((citation) => {
            const safeUrl = safeCitationUrl(citation.url);
            const contents = (
              <>
                <span>{citation.label}</span>
                {citation.excerpt ? <span className={styles.citationExcerpt}>{citation.excerpt}</span> : null}
              </>
            );
            return citation.titleId ? (
              <button
                className={`${styles.citation} ${styles.citationButton}`}
                key={citation.id}
                type="button"
                onClick={() => onTitle(citation.titleId!)}
                aria-label={`Open ${citation.label} in Ludex`}
              >
                <LinkSimple size={12} aria-hidden="true" /> {contents}
              </button>
            ) : safeUrl ? (
              <a
                className={styles.citation}
                href={safeUrl}
                key={citation.id}
                target="_blank"
                rel="noreferrer"
              >
                <LinkSimple size={12} aria-hidden="true" /> {contents}
              </a>
            ) : (
              <div className={styles.citation} key={citation.id}>{contents}</div>
            );
          })}
        </div>
      ) : null}

      {actions.map((action) => (
        <div className={styles.action} key={action.id}>
          <strong>{action.label}</strong>
          <p>{action.summary}</p>
          {action.status === "pending" ? (
            <>
              <p className={styles.settled}>Nothing changes until you confirm.</p>
              <div className={styles.actionButtons}>
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={busyAction !== null}
                  onClick={() => onDecide(action, "confirm")}
                >
                  <Check size={13} aria-hidden="true" /> Confirm
                </button>
                <button
                  type="button"
                  className={styles.reject}
                  disabled={busyAction !== null}
                  onClick={() => onDecide(action, "reject")}
                >
                  <X size={13} aria-hidden="true" /> Dismiss
                </button>
              </div>
            </>
          ) : (
            <p className={styles.settled} role="status">
              {action.status === "confirmed" ? "Confirmed" : "Dismissed"}
            </p>
          )}
        </div>
      ))}
    </article>
  );
}

function safeCitationUrl(value?: string) {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function resultMessage(value: unknown, fallback: string) {
  const message = objectValue(value)?.message;
  return typeof message === "string" ? message : fallback;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof LudexError) {
    if (error.status === 401 || error.status === 403)
      return "Your Ludex session has expired. Sign in again to continue.";
    if (error.status === 429 || error.code === "allowance-exhausted")
      return "Your assistant allowance is used for now. Your saved conversation is still here.";
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function isAuthError(error: unknown) {
  return error instanceof LudexError && (error.status === 401 || error.status === 403);
}
