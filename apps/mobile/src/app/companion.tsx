import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { Button, Text, TextInput } from "react-native-paper";
import { LudexError, type Session } from "@ludex/client";
import {
  createAssistantClient,
  type AssistantAction,
  type AssistantMessage,
  type AssistantRequest,
  type AssistantState,
} from "../../../../packages/client/src/assistant.ts";
import { useLudex } from "../state";
import { Heading, styles } from "../ui";
import { colors, font, type } from "../theme";

const prompts = [
  "Find a clever heist film",
  "Show me a short game",
  "Search for a time-loop story",
];

export default function Companion() {
  const { client, ready, session, reducedMotion, refresh } = useLudex();
  return (
    <Conversation
      key={session?.user.id ?? "guest"}
      client={client}
      ready={ready}
      session={session}
      reducedMotion={reducedMotion}
      refresh={refresh}
    />
  );
}

function Conversation({
  client,
  ready,
  session,
  reducedMotion,
  refresh,
}: {
  client: AssistantRequest;
  ready: boolean;
  session: Session | null;
  reducedMotion: boolean;
  refresh: (replace?: boolean) => Promise<void>;
}) {
  const assistant = useMemo(() => createAssistantClient(client), [client]);
  const [state, setState] = useState<AssistantState | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [authExpired, setAuthExpired] = useState(false);
  const [notice, setNotice] = useState("");
  const requestVersion = useRef(0);
  const conversation = useRef<ScrollView>(null);

  const refreshState = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const next = await assistant.readState();
      if (version === requestVersion.current) {
        setState(next);
        setAuthExpired(false);
      }
      return version === requestVersion.current;
    } catch (cause) {
      if (version === requestVersion.current) {
        setError(errorText(cause, "Your saved conversation could not be loaded."));
        setAuthExpired(isAuthError(cause));
      }
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [assistant]);

  useEffect(() => {
    requestVersion.current++;
    if (ready && session) void refreshState();
    const currentRequest = requestVersion;
    return () => {
      currentRequest.current++;
    };
  }, [ready, refreshState, session?.user.id]);

  const messages = Array.isArray(state?.messages) ? state.messages : [];
  const remaining = state?.allowance?.remaining;
  const exhausted =
    state?.status === "allowance-exhausted" ||
    state?.status === "disabled" ||
    (typeof remaining === "number" && remaining <= 0);

  const scrollToLatest = () => {
    conversation.current?.scrollToEnd({ animated: !reducedMotion });
  };

  async function send() {
    const text = draft.trim();
    if (!session || !state || !text || sending || exhausted) return;
    setError("");
    setAuthExpired(false);
    setNotice("");
    setSending(true);
    try {
      const response = await assistant.sendMessage(text, Crypto.randomUUID());
      const status = recordValue(response)?.status;
      if (status === "rejected" || status === "conflict" || status === "allowance-exhausted") {
        await refreshState();
        setError(responseMessage(response, "Your assistant allowance is used for now. Your journal has not changed."));
        setAuthExpired(false);
        return;
      }
      setDraft("");
      if (!(await refreshState()))
        setNotice("Your message was sent, but the saved conversation could not refresh. Use Refresh to check for the reply.");
    } catch (cause) {
      setError(errorText(cause, "Your message could not be sent."));
      setAuthExpired(isAuthError(cause));
    } finally {
      setSending(false);
    }
  }

  async function decide(action: AssistantAction, decision: "confirm" | "reject") {
    setBusyAction(action.id);
    setError("");
    setAuthExpired(false);
    setNotice("");
    try {
      const response =
        decision === "confirm"
          ? await assistant.confirmAction(action.id)
          : await assistant.rejectAction(action.id);
      const status = recordValue(response)?.status;
      if (status === "rejected") {
        await refreshState();
        setError(responseMessage(response, "That action was not accepted. Your journal has not changed."));
        setAuthExpired(false);
        return;
      }
      if (status === "pending") {
        await refreshState();
        setNotice("That action is still pending. Your journal has not changed yet.");
        return;
      }
      if (decision === "confirm" && status === "confirmed") {
        try {
          await refresh(true);
        } catch {
          await refreshState();
          setNotice("Action confirmed. Your conversation is refreshed, but the library could not reload.");
          return;
        }
      }
      if (await refreshState())
        setNotice(decision === "confirm" ? "Confirmed. Your journal is up to date." : "Suggestion dismissed.");
    } catch (cause) {
      await refreshState();
      setError(errorText(cause, "That action could not be completed."));
      setAuthExpired(isAuthError(cause));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={local.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 72 : 0}
    >
      <ScrollView
        ref={conversation}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, local.content]}
        onContentSizeChange={scrollToLatest}
      >
        <Heading
          context="AFTER HOURS · YOUR JOURNAL"
          title="A little help choosing."
        />

        <View style={local.statusCard} accessibilityLiveRegion="polite">
          <Text style={local.statusTitle}>
            {!ready
              ? "Opening your journal…"
              : !session
                ? "Sign in to continue your private conversation"
                : loading && !state
                  ? "Loading your saved conversation…"
                  : state?.status === "unconfigured"
                    ? "AI generation is off · catalog fallback available"
                    : state?.status === "disabled"
                      ? "The companion is temporarily unavailable"
                      : exhausted
                        ? "Your assistant allowance is used for now"
                        : "Your conversation is saved to your Ludex account"}
          </Text>
          {session && state ? (
            <Text style={local.allowance}>
              {typeof remaining === "number"
                ? `${Math.max(0, remaining)}${typeof state.allowance?.limit === "number" ? ` of ${state.allowance.limit}` : ""} left`
                : "Usage details unavailable"}
            </Text>
          ) : null}
        </View>

        {state?.status === "unconfigured" ? (
          <View style={local.notice} accessibilityLiveRegion="polite">
            <Text style={local.noticeTitle}>Catalog fallback</Text>
            <Text style={local.noticeText}>
              Azure AI is not configured for this environment. Catalog searches can still return deterministic matches. Those replies are marked and are not presented as AI-generated.
            </Text>
          </View>
        ) : null}
        {state && exhausted && state.status !== "disabled" ? (
          <View style={[local.notice, local.warning]} accessibilityLiveRegion="polite">
            <Text style={local.noticeTitle}>Allowance reached</Text>
            <Text style={local.noticeText}>
              Your saved conversation is still here. Sending new requests is paused until the allowance refreshes. Pending actions still require your review.
            </Text>
          </View>
        ) : null}
        {state?.status === "disabled" ? (
          <View style={[local.notice, local.warning]} accessibilityLiveRegion="polite">
            <Text style={local.noticeTitle}>Unavailable</Text>
            <Text style={local.noticeText}>
              The assistant service is not accepting requests right now. Your saved messages remain available below.
            </Text>
          </View>
        ) : null}

        {loading && !state && session ? (
          <Text style={local.centerNote} accessibilityLiveRegion="polite">
            Opening your saved conversation…
          </Text>
        ) : null}
        {state && messages.length === 0 ? (
          <View style={local.empty}>
            <Text style={local.emptyTitle}>A quiet place to begin.</Text>
            <Text style={local.emptyText}>
              Ask about a film, series, or game. Any change to your journal will wait for your confirmation.
            </Text>
            <View style={local.promptList}>
              {prompts.map((prompt) => (
                <Button
                  key={prompt}
                  mode="outlined"
                  compact
                  onPress={() => setDraft(prompt)}
                  style={local.prompt}
                  accessibilityLabel={`Use example: ${prompt}`}
                >
                  {prompt}
                </Button>
              ))}
            </View>
          </View>
        ) : null}

        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            onDecide={decide}
            onTitle={(titleId) => router.push({ pathname: "/title", params: { id: titleId } })}
            busyAction={busyAction}
          />
        ))}
        {sending ? (
          <Text style={local.centerNote} accessibilityLiveRegion="polite">
            Sending your question…
          </Text>
        ) : null}
        {notice ? (
          <Text style={local.centerNote} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {error ? (
          <View style={local.error} accessibilityRole="alert">
            <Text style={local.errorText}>{error}</Text>
            <Button
              onPress={() => authExpired ? router.push("/auth") : void refreshState()}
              compact
              accessibilityLabel={authExpired ? "Sign in again" : "Refresh saved conversation"}
            >
              {authExpired ? "Sign in again" : "Refresh conversation"}
            </Button>
          </View>
        ) : null}
      </ScrollView>

      {ready && session ? (
        <View style={local.composer}>
          <TextInput
            mode="outlined"
            value={draft}
            onChangeText={setDraft}
            placeholder={exhausted ? "Your allowance is paused" : "Ask about what to watch or play…"}
            accessibilityLabel="Ask your Ludex companion"
            multiline
            maxLength={1000}
            disabled={!state || loading || sending || exhausted}
            dense
            outlineColor={colors.outline}
            activeOutlineColor={colors.coral}
            textColor={colors.pearl}
            placeholderTextColor={colors.muted}
            style={local.input}
            contentStyle={local.inputContent}
          />
          <Button
            mode="contained"
            onPress={() => void send()}
            disabled={!draft.trim() || !state || loading || sending || exhausted}
            style={local.send}
            contentStyle={local.sendContent}
            accessibilityLabel={sending ? "Sending message" : "Send message"}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </View>
      ) : ready ? (
        <View style={local.signIn}>
          <Text style={local.emptyText}>
            Your chat history is tied to your account and is not stored on this device.
          </Text>
          <Button mode="contained" onPress={() => router.push("/auth")}>
            Sign in to continue
          </Button>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function MessageCard({
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
  const parsedTime = new Date(message.createdAt);
  const timeLabel = Number.isNaN(parsedTime.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(parsedTime);

  return (
    <View style={[local.message, user ? local.userMessage : null]}>
      <View style={local.messageMeta}>
        <Text style={local.messageAuthor}>{user ? "You" : "Ludex companion"}</Text>
        {timeLabel ? <Text style={local.messageTime}>{timeLabel}</Text> : null}
        {!user && message.fallback ? <Text style={local.fallback}>CATALOG FALLBACK · NO AI</Text> : null}
      </View>
      <View style={[local.bubble, user ? local.userBubble : null]}>
        <Text style={local.messageText}>{message.text}</Text>
      </View>

      {citations.length ? (
        <View style={local.citations} accessibilityLabel="Sources">
          <Text style={local.sectionLabel}>Sources</Text>
          {citations.map((citation) => (
            <View key={citation.id} style={local.citation}>
              {citation.titleId ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${citation.label} in Ludex`}
                  onPress={() => onTitle(citation.titleId!)}
                  style={local.citationLink}
                >
                  <Text style={local.citationLabel}>{citation.label}</Text>
                </Pressable>
              ) : (
                <Text style={local.citationLabel}>{citation.label}</Text>
              )}
              {citation.excerpt ? <Text style={local.citationExcerpt}>{citation.excerpt}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {actions.map((action) => (
        <View key={action.id} style={local.action}>
          <Text style={local.actionTitle}>{action.label}</Text>
          <Text style={local.actionSummary}>{action.summary}</Text>
          {action.status === "pending" ? (
            <>
              <Text style={local.actionHint}>Nothing changes until you confirm.</Text>
              <View style={local.actionButtons}>
                <Button
                  mode="contained"
                  compact
                  onPress={() => onDecide(action, "confirm")}
                  disabled={busyAction !== null}
                  accessibilityLabel={`Confirm ${action.label}`}
                >
                  Confirm
                </Button>
                <Button
                  mode="outlined"
                  compact
                  onPress={() => onDecide(action, "reject")}
                  disabled={busyAction !== null}
                  accessibilityLabel={`Dismiss ${action.label}`}
                >
                  Dismiss
                </Button>
              </View>
            </>
          ) : (
            <Text style={local.actionHint} accessibilityLiveRegion="polite">
              {action.status === "confirmed" ? "Confirmed" : "Dismissed"}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function responseMessage(value: unknown, fallback: string) {
  const message = recordValue(value)?.message;
  return typeof message === "string" ? message : fallback;
}

function errorText(cause: unknown, fallback: string) {
  if (cause instanceof LudexError) {
    if (cause.status === 401 || cause.status === 403)
      return "Your Ludex session has expired. Sign in again to continue.";
    if (cause.status === 429 || cause.code === "allowance-exhausted")
      return "Your assistant allowance is used for now. Your saved conversation is still here.";
    return cause.message || fallback;
  }
  return cause instanceof Error ? cause.message : fallback;
}

function isAuthError(cause: unknown) {
  return cause instanceof LudexError && (cause.status === 401 || cause.status === 403);
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, paddingTop: 20, paddingBottom: 18 },
  statusCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 9,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  statusTitle: { ...type.metadata, flex: 1, color: colors.orchid, fontSize: 11, lineHeight: 17 },
  allowance: { ...font.semibold, color: colors.lime, fontSize: 10, textAlign: "right" as const },
  notice: {
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#715d43",
    borderRadius: 8,
    backgroundColor: "#2b2230",
  },
  warning: { borderColor: "#775253", backgroundColor: "#302027" },
  noticeTitle: { ...font.semibold, color: colors.lime, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  noticeText: { ...type.body, color: colors.pearl, fontSize: 11, lineHeight: 18 },
  centerNote: { ...type.metadata, alignSelf: "center", color: colors.muted, fontSize: 11, textAlign: "center", marginVertical: 12 },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 17,
    marginTop: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  emptyTitle: { ...type.title, color: colors.pearl, fontSize: 17, textAlign: "center", marginBottom: 7 },
  emptyText: { ...type.body, color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginBottom: 10 },
  promptList: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "center" as const, gap: 7, marginTop: 5 },
  prompt: { borderColor: colors.outline, borderRadius: 20 },
  message: { alignSelf: "flex-start" as const, width: "92%" as const, marginVertical: 6, gap: 7 },
  userMessage: { alignSelf: "flex-end" as const, alignItems: "flex-end" as const },
  messageMeta: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 8, paddingHorizontal: 2 },
  messageAuthor: { ...font.semibold, color: colors.orchid, fontSize: 10 },
  messageTime: { ...type.metadata, color: colors.muted, fontSize: 9 },
  fallback: { ...font.semibold, color: colors.lime, fontSize: 8, letterSpacing: 0.7 },
  bubble: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.outline, borderTopLeftRadius: 4, borderTopRightRadius: 13, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, backgroundColor: colors.surface },
  userBubble: { borderTopLeftRadius: 13, borderTopRightRadius: 4, backgroundColor: colors.raised },
  messageText: { ...type.body, color: colors.pearl, fontSize: 12, lineHeight: 20 },
  citations: { gap: 6, paddingLeft: 2 },
  sectionLabel: { ...font.semibold, color: colors.muted, fontSize: 9, letterSpacing: 1, textTransform: "uppercase" as const },
  citation: { paddingVertical: 7, paddingHorizontal: 10, borderLeftWidth: 2, borderLeftColor: colors.orchid, backgroundColor: colors.surface },
  citationLink: { minHeight: 36, justifyContent: "center" as const },
  citationLabel: { ...font.medium, color: colors.pearl, fontSize: 10, lineHeight: 16 },
  citationExcerpt: { ...type.body, color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 3 },
  action: { padding: 11, borderWidth: 1, borderColor: colors.outline, borderRadius: 8, backgroundColor: colors.raised },
  actionTitle: { ...font.semibold, color: colors.pearl, fontSize: 12, marginBottom: 4 },
  actionSummary: { ...type.body, color: colors.muted, fontSize: 11, lineHeight: 17 },
  actionHint: { ...type.metadata, color: colors.orchid, fontSize: 9, marginTop: 5 },
  actionButtons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginTop: 8 },
  error: { padding: 10, borderWidth: 1, borderColor: colors.error, borderRadius: 7, backgroundColor: colors.surface, marginBottom: 8 },
  errorText: { ...type.body, color: colors.error, fontSize: 11, lineHeight: 17 },
  composer: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.outline, backgroundColor: colors.ink },
  input: { flex: 1, maxHeight: 112, backgroundColor: colors.surface },
  inputContent: { ...type.body, fontSize: 12, lineHeight: 18 },
  send: { marginBottom: 5, backgroundColor: colors.coral },
  sendContent: { minHeight: 39, paddingHorizontal: 5 },
  signIn: { gap: 10, padding: 16, paddingBottom: 24, borderTopWidth: 1, borderTopColor: colors.outline },
});
