import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Haptics from "expo-haptics";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { base64url, readGoogleHandoff } from "./auth/google";
import { AppState, Platform, AccessibilityInfo } from "react-native";
import { LudexClient, LudexError } from "@ludex/client";
import type {
  ActivityPage,
  CatalogHit,
  LibraryEditCommand,
  LibraryItem,
  Preview,
  ProgressCommand,
  Session,
  Showcase,
} from "@ludex/domain";
import { clearSession, persistSession, restoreSession } from "./auth/session";
import { openOwnerStore } from "./storage/database";
import type { OwnerStore, Pending } from "./storage/outbox";
import { offerRefresh } from "./features/feed/model";
import { drain } from "./sync/drain";
import { pollDelay } from "./sync/poll";
const api =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:4000/api"
    : "http://localhost:4000/api");
const emptyFeed: ActivityPage = { items: [], etag: "" };
type Context = {
  client: LudexClient;
  reducedMotion: boolean;
  session: Session | null;
  ready: boolean;
  preview: Preview | null;
  catalog: CatalogHit[];
  library: LibraryItem[];
  feed: ActivityPage;
  showcase: Showcase | null;
  store: OwnerStore | null;
  pending: Pending[];
  error: string | null;
  notice: string | null;
  newFeed: ActivityPage | null;
  settings: Record<string, unknown>;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    name: string,
    invite: string,
  ) => Promise<void>;
  googleLogin: (invite: string) => Promise<void>;
  logout: () => Promise<void>;
  loadPreview: () => Promise<void>;
  refresh: (replace?: boolean) => Promise<void>;
  acceptFeed: () => void;
  queue: (
    kind: "progress" | "library",
    command: ProgressCommand | LibraryEditCommand,
  ) => Promise<void>;
  sync: () => Promise<void>;
  setNotice: (message: string | null) => void;
  saveSettings: (settings: Record<string, unknown>) => Promise<void>;
  setShowcase: (showcase: Showcase) => void;
  updatePending: () => Promise<void>;
};
const State = createContext<Context | null>(null);
export function useLudex() {
  const value = useContext(State);
  if (!value) throw new Error("State provider missing");
  return value;
}
export function LudexProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => new LudexClient({ baseUrl: api }), []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [catalog, setCatalog] = useState<CatalogHit[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [feed, setFeed] = useState(emptyFeed);
  const [newFeed, setNewFeed] = useState<ActivityPage | null>(null);
  const [showcase, setShowcase] = useState<Showcase | null>(null);
  const [store, setStore] = useState<OwnerStore | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [systemReduced, setSystemReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduced);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemReduced,
    );
    return () => sub.remove();
  }, []);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const closeRef = useRef<null | (() => Promise<void>)>(null);
  const draining = useRef(false);
  const identity = useRef<string | null>(null);
  const refreshFailures = useRef(0);
  const retryAfter = useRef<number | undefined>(undefined);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const reset = useCallback(() => {
    setPreview(null);
    setCatalog([]);
    setLibrary([]);
    setFeed(emptyFeed);
    setNewFeed(null);
    setShowcase(null);
    setPending([]);
    setSettings({});
    setStore(null);
    setError(null);
  }, []);
  const attach = useCallback(
    async (s: Session) => {
      await closeRef.current?.();
      reset();
      identity.current = s.user.id;
      client.setToken(s.token);
      setSession(s);
      const opened = await openOwnerStore(s.user.id);
      if (identity.current !== s.user.id) {
        await opened.close();
        return;
      }
      closeRef.current = opened.close;
      setStore(opened.store);
      setLibrary((await opened.store.cached<LibraryItem[]>("library")) ?? []);
      setCatalog((await opened.store.cached<CatalogHit[]>("catalog")) ?? []);
      setSettings(
        (await opened.store.cached<Record<string, unknown>>("settings")) ?? {},
      );
      setPending(await opened.store.pending());
      setShowcase(await opened.store.cached<Showcase>("showcase"));
    },
    [client, reset],
  );
  useEffect(() => {
    restoreSession()
      .then(async (s) => {
        if (s) await attach(s);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReady(true));
    return () => {
      void closeRef.current?.();
    };
  }, [attach]);
  const updatePending = useCallback(async () => {
    if (store) setPending(await store.pending());
  }, [store]);
  const refresh = useCallback(
    async (replace = false) => {
      if (!session || !store) return;
      const owner = session.user.id;
      try {
        const [titles, items, page, profile, prefs] = await Promise.all([
          client.searchCatalog({ region: String(settings.region ?? "US") }),
          client.readLibrary(),
          client.readFeed({ limit: 20, filter: "following" }),
          client.readShowcase(owner),
          client.getSettings(),
        ]);
        if (identity.current !== owner) return;
        const missing = items.filter(
          (entry) => !titles.some((t) => t.id === entry.titleId),
        );
        const resolved = await Promise.allSettled(
          missing.map((entry) => client.getTitle(entry.titleId)),
        );
        if (identity.current !== owner) return;
        const allTitles = [
          ...titles,
          ...resolved.flatMap((r) =>
            r.status === "fulfilled" ? [r.value] : [],
          ),
        ];
        setCatalog(allTitles);
        setLibrary(items);
        setShowcase(profile);
        setSettings(prefs);
        await Promise.all([
          store.cache("catalog", allTitles, 7 * 86400000),
          store.cache("library", items),
          store.cache("settings", prefs),
          store.cache("showcase", profile),
        ]);
        if (replace || !feedRef.current.items.length) setFeed(page);
        else {
          const refreshed = offerRefresh(feedRef.current, page);
          setFeed(refreshed.displayed);
          setNewFeed(refreshed.offered);
        }
        setError(null);
        refreshFailures.current = 0;
        retryAfter.current = undefined;
      } catch (e) {
        if (identity.current !== owner) return;
        setError(e instanceof Error ? e.message : "Connection unavailable");
        refreshFailures.current++;
        retryAfter.current =
          e instanceof LudexError ? e.retryAfterSeconds : undefined;
        if (e instanceof LudexError && (e.status === 401 || e.status === 403)) {
          client.setToken(null);
          await clearSession();
          await store.purge();
          identity.current = null;
          setSession(null);
          reset();
          setError("Your session ended. Sign in again.");
        }
      }
    },
    [session, store, client, settings.region, reset],
  );
  const sync = useCallback(async () => {
    if (!session || !store || draining.current) return;
    draining.current = true;
    try {
      const result = await drain(store, (entry) =>
        entry.kind === "progress"
          ? client.applyProgress(entry.payload as ProgressCommand)
          : client.editLibrary(entry.payload as LibraryEditCommand),
      );
      for (const receipt of result.acceptedResults) {
        if (receipt.status === "accepted") {
          await store.saveDraft("undo:" + receipt.commandId, receipt);
          const original = await store.draft<ProgressCommand>(
            "submitted:" + receipt.commandId,
          );
          if (original?.change)
            await store.saveDraft("last-progress", {
              ...receipt,
              titleId: original.titleId,
            });
        }
      }
      await updatePending();
      if (result.accepted) {
        setNotice(`${result.accepted} saved to your journal`);
        await refresh();
      }
    } finally {
      draining.current = false;
    }
  }, [session, store, client, refresh, updatePending]);
  useEffect(() => {
    if (!session || !store) return;
    void refresh(true).then(sync);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const tick = async () => {
      if (AppState.currentState === "active") {
        try {
          await sync();
          await refresh();
        } catch {
          refreshFailures.current++;
        }
      }
      if (!stopped)
        timer = setTimeout(
          tick,
          pollDelay(refreshFailures.current, retryAfter.current),
        );
    };
    timer = setTimeout(tick, 30000);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void sync().then(() => refresh());
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [session?.user.id, store]);
  const login = async (email: string, password: string) => {
    const s = await client.login({ email, password });
    await persistSession(s);
    await attach(s);
  };
  const signup = async (
    email: string,
    password: string,
    name: string,
    invite: string,
  ) => {
    const s = await client.signup({
      email,
      password,
      displayName: name,
      inviteCode: invite,
    });
    await persistSession(s);
    await attach(s);
  };
  const googleLogin = async (invite: string) => {
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const challenge = base64url(
      await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        verifier,
        { encoding: Crypto.CryptoEncoding.BASE64 },
      ),
    );
    const start = await client.request<{ url: string; state: string }>(
      "/auth/google/native/start",
      { inviteCode: invite, codeChallenge: challenge },
      "POST",
    );
    const result = await WebBrowser.openAuthSessionAsync(
      start.url,
      "ludex://auth",
    );
    if (result.type !== "success")
      throw new Error("Google sign-in was cancelled.");
    const code = readGoogleHandoff(result.url, start.state);
    const s = await client.request<Session>(
      "/auth/google/native/exchange",
      { code, codeVerifier: verifier },
      "POST",
    );
    await persistSession(s);
    await attach(s);
  };
  const logout = async () => {
    try {
      await client.logout();
    } catch {
      setNotice(
        "Signed out on this device. The server session expires automatically.",
      );
    }
    await store?.purge();
    await clearSession();
    client.setToken(null);
    identity.current = null;
    setSession(null);
    reset();
    await closeRef.current?.();
    closeRef.current = null;
  };
  const loadPreview = async () => {
    setCatalog(await client.searchCatalog());
    setPreview(null);
    setFeed(emptyFeed);
    setShowcase(null);
  };
  const queue = async (
    kind: "progress" | "library",
    command: ProgressCommand | LibraryEditCommand,
  ) => {
    if (!store || !session) throw new Error("Sign in to save your journal.");
    await store.enqueue(kind, command);
    await updatePending();
    setNotice("Saved on this device • waiting to sync");
    if (settings.haptics)
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void sync();
  };
  const saveSettings = async (value: Record<string, unknown>) => {
    const saved = await client.saveSettings(value);
    setSettings(saved);
    await store?.cache("settings", saved);
    setNotice("Preferences saved");
  };
  const value: Context = {
    client,
    reducedMotion: systemReduced || Boolean(settings.reducedMotion),
    session,
    ready,
    preview,
    catalog,
    library,
    feed,
    showcase,
    store,
    pending,
    error,
    notice,
    newFeed,
    settings,
    login,
    signup,
    googleLogin,
    logout,
    loadPreview,
    refresh,
    acceptFeed: () => {
      if (newFeed) {
        setFeed(newFeed);
        setNewFeed(null);
      }
    },
    queue,
    sync,
    setNotice,
    saveSettings,
    setShowcase,
    updatePending,
  };
  return <State.Provider value={value}>{children}</State.Provider>;
}
