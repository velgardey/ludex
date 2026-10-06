"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LudexClient,
  type Activity,
  type CatalogHit,
  type LibraryItem,
  type Preview,
  type Session,
  type Showcase,
  type User,
} from "@ludex/client";
import { refreshVisibleFeed } from "../feed";
import { readJournalPanels } from "../refresh";
export function useLudex() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [catalog, setCatalog] = useState<CatalogHit[]>([]),
    [feed, setFeed] = useState<Activity[]>([]),
    [library, setLibrary] = useState<LibraryItem[]>([]),
    [people, setPeople] = useState<User[]>([]),
    [showcase, setShowcase] = useState<Showcase | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [newFeed, setNewFeed] = useState<Activity[] | null>(null),
    [feedFilter, updateFeedFilter] = useState<"following" | "friends">(
      "following",
    ),
    [social, setSocial] = useState<
      Record<
        string,
        {
          following: boolean;
          followers: number;
          followingCount: number;
          friendship: unknown;
        }
      >
    >({});
  const client = useMemo(
    () =>
      new LudexClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api",
        token: session?.token,
      }),
    [session?.token],
  );
  // Identity/filter changes invalidate every request and pending snapshot immediately.
  const scope = useRef({ generation: 0, request: 0 });
  const feedRef = useRef(feed);
  const clearAccount = () => {
    scope.current.generation++;
    setNewFeed(null);
    setFeed([]);
    feedRef.current = [];
    setLibrary([]);
    setPeople([]);
    setSocial({});
    setShowcase(null);
    setError("");
  };
  const setFeedFilter = (filter: "following" | "friends") => {
    if (filter === feedFilter) return;
    scope.current.generation++;
    setNewFeed(null);
    setFeed([]);
    feedRef.current = [];
    updateFeedFilter(filter);
  };
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  useEffect(() => {
    queueMicrotask(() => {
      const stored = localStorage.getItem("ludex-session");
      if (stored) {
        try {
          setSession(JSON.parse(stored));
        } catch {
          localStorage.removeItem("ludex-session");
        }
      }
      const url = new URL(window.location.href);
      if (url.searchParams.get("auth") === "complete") {
        const cookieClient = new LudexClient({
          baseUrl:
            process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api",
        });
        cookieClient
          .me()
          .then((user) => {
            // HttpOnly cookie remains the credential; only public account state is kept here.
            const s: Session = {
              token: "",
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              user,
            };
            localStorage.setItem("ludex-session", JSON.stringify(s));
            setSession(s);
            url.searchParams.delete("auth");
            window.history.replaceState(null, "", url.pathname + url.search);
          })
          .catch(() =>
            setError(
              "Google session could not be restored. Please sign in again.",
            ),
          );
      }
      setReady(true);
    });
  }, []);
  const refresh = useCallback(async () => {
    const generation = scope.current.generation;
    const request = ++scope.current.request;
    const current = () =>
      generation === scope.current.generation &&
      request === scope.current.request;
    try {
      if (session) {
        const panels = await readJournalPanels({
          catalog: () => client.searchCatalog(),
          feed: () => client.readFeed({ limit: 20, filter: feedFilter }),
          library: () => client.readLibrary(),
          people: () => client.discoverUsers(),
          showcase: () => client.readShowcase(session.user.id),
        });
        if (!current()) return;
        if (panels.catalog || panels.library) {
          const titles = panels.catalog ?? [];
          const missing =
            panels.library?.filter(
              (entry) => !titles.some((t) => t.id === entry.titleId),
            ) ?? [];
          const resolved = await Promise.allSettled(
            missing.map((entry) => client.getTitle(entry.titleId)),
          );
          if (!current()) return;
          setCatalog([
            ...titles,
            ...resolved.flatMap((r) =>
              r.status === "fulfilled" ? [r.value] : [],
            ),
          ]);
        }
        if (panels.feed) {
          setFeed(panels.feed.items);
          feedRef.current = panels.feed.items;
          setNewFeed(null);
        }
        if (panels.library) setLibrary(panels.library);
        if (panels.people) {
          setPeople(panels.people);
          const statuses = await Promise.allSettled(
            panels.people
              .filter((u) => !u.sample)
              .map(
                async (u) => [u.id, await client.socialStatus(u.id)] as const,
              ),
          );
          if (!current()) return;
          setSocial(
            Object.fromEntries(
              statuses.flatMap((s) =>
                s.status === "fulfilled" ? [s.value] : [],
              ),
            ),
          );
        }
        if (panels.showcase) setShowcase(panels.showcase);
        setError(
          panels.failures.length
            ? `Could not refresh ${panels.failures.join(", ")}. Your other panels are up to date.`
            : "",
        );
      } else {
        // The real beta has no fictional public journal. Guests can browse the catalog.
        const titles = await client.searchCatalog();
        if (!current()) return;
        setPreview(null);
        setCatalog(titles);
        setNewFeed(null);
        setSocial({});
        setFeed([]);
        setPeople([]);
        setShowcase(null);
        setLibrary([]);
        setError("");
      }
    } catch (e) {
      if (!current()) return;
      setError(
        e instanceof Error
          ? e.message
          : "The journal could not refresh. Try again.",
      );
    }
  }, [client, session, feedFilter]);
  useEffect(() => {
    if (ready) queueMicrotask(() => void refresh());
  }, [ready, refresh]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const generation = scope.current.generation;
      const request = ++scope.current.request;
      client
        .readFeed({ limit: 20, filter: feedFilter })
        .then((p) => {
          if (
            generation !== scope.current.generation ||
            request !== scope.current.request
          )
            return;
          const old = feedRef.current;
          const visible = refreshVisibleFeed(old, p.items);
          feedRef.current = visible;
          setFeed(visible);
          setNewFeed(
            p.items.some(
              (item) => !old.some((existing) => existing.id === item.id),
            )
              ? p.items
              : null,
          );
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [client, session, feedFilter]);
  const authenticate = async (
    mode: "signup" | "login",
    fields: {
      email: string;
      password: string;
      displayName: string;
      inviteCode: string;
    },
  ) => {
    setBusy(true);
    try {
      const s = await client[mode](fields);
      clearAccount();
      localStorage.setItem("ludex-session", JSON.stringify(s));
      setSession(s);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    // Clear before revocation completes so pending responses cannot restore owner data.
    clearAccount();
    localStorage.removeItem("ludex-session");
    setSession(null);
    setPreview(null);
    await client.logout();
  };
  return {
    session,
    ready,
    preview,
    catalog,
    feed,
    library,
    people,
    showcase,
    error,
    busy,
    client,
    refresh,
    authenticate,
    logout,
    newFeed,
    social,
    feedFilter,
    setFeedFilter,
    acceptNewFeed: () => {
      if (session && newFeed) {
        setFeed(newFeed);
        feedRef.current = newFeed;
      }
      setNewFeed(null);
    },
    setShowcase,
    setFeed,
  };
}
