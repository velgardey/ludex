"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookmarkSimple,
  Check,
  Compass,
  FilmSlate,
  GameController,
  GearSix,
  House,
  LockSimple,
  MagnifyingGlass,
  Plus,
  SignOut,
  Sparkle,
  Stack,
  Television,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Activity, CatalogHit, Showcase, User } from "@ludex/client";
import { useLudex } from "./hooks/useLudex";
import {
  Collections,
  ReviewEditor,
  Moderation,
} from "./components/JournalTools";
import { makeLog } from "./commands";
import { Feed } from "./components/Feed";
import { PremiereStage } from "./components/PremiereStage";
import { Library } from "./components/Library";
import { Profile } from "./components/Profile";
import { Companion } from "./components/Companion";
import { Connections } from "./components/Connections";
import { Plans } from "./components/Plans";
import { AuthForm, LogForm, ShowcaseEditor } from "./components/Forms";
import { Artwork, Avatar, Empty, Modal } from "./components/Primitives";
type Page =
  | "feed"
  | "library"
  | "discover"
  | "profile"
  | "title"
  | "activity"
  | "collection"
  | "settings"
  | "moderation"
  | "plan";
const navigation = [
  { id: "feed", label: "Feed", icon: House },
  { id: "library", label: "Library", icon: Stack },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "profile", label: "Showcase", icon: BookmarkSimple },
] as const;
export function LudexApp({ initialPage = "feed" }: { initialPage?: Page }) {
  const data = useLudex();
  const { session, catalog, feed, library, people, showcase, client } = data;
  const [page, setPage] = useState<Page>(initialPage),
    [auth, setAuth] = useState(false),
    [logTitle, setLogTitle] = useState<CatalogHit | null>(null),
    [detail, setDetail] = useState<CatalogHit | null>(null),
    [profileUser, setProfileUser] = useState<User | null>(null),
    [editing, setEditing] = useState(false),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState(""),
    [media, setMedia] = useState("All"),
    [searchTitles, setSearchTitles] = useState<CatalogHit[] | null>(null),
    [searchPending, setSearchPending] = useState(false),
    [searchError, setSearchError] = useState(""),
    [discussion, setDiscussion] = useState<Activity | null>(null),
    [replies, setReplies] = useState<
      { id: string; text?: string; author: User; detailHidden: boolean }[]
    >([]),
    [menuActivity, setMenuActivity] = useState<Activity | null>(null),
    [companion, setCompanion] = useState(false),
    [connections, setConnections] = useState(false),
    [settings, setSettings] = useState<Record<string, unknown>>({}),
    [notifications, setNotifications] = useState(false),
    [inbox, setInbox] = useState<
      {
        id: string;
        kind: string;
        body: { title?: string; planId?: string };
        createdAt: string;
      }[]
    >([]),
    [inboxError, setInboxError] = useState(""),
    [reviewTitle, setReviewTitle] = useState<CatalogHit | null>(null),
    [undo, setUndo] = useState<{
      eventId: string;
      titleId: string;
      version: number;
    } | null>(null),
    [profileShowcase, setProfileShowcase] = useState<Showcase | null>(null);
  const [settingsToken, setSettingsToken] = useState<string | null>(null);
  const artEnabled =
    data.ready &&
    (!session ||
      (settingsToken === session.token && !Boolean(settings.lowData)));
  const scrollPositions = useRef<Record<string, number>>({});
  const replyPending = useRef(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const accountToken = useRef(session?.token);
  useLayoutEffect(() => {
    accountToken.current = session?.token;
  }, [session?.token]);
  useEffect(() => {
    let active = true;
    if (!notifications || !session) return;
    client
      .request<typeof inbox>("/notifications")
      .then((v) => {
        if (active) {
          setInbox(v);
          setInboxError("");
        }
      })
      .catch((e) => {
        if (active) setInboxError(e.message);
      });
    return () => {
      active = false;
    };
  }, [notifications, session, client]);
  const followed = Object.keys(data.social).filter(
    (id) => data.social[id].following,
  );
  useEffect(() => {
    let active = true;
    if (!session) return;
    client
      .getSettings()
      .then((s) => {
        if (!active) return;
        setSettings(s);
        setSettingsToken(session.token);
        document.documentElement.classList.toggle(
          "reduce-motion",
          Boolean(s.reducedMotion),
        );
        document.documentElement.classList.toggle(
          "low-data",
          Boolean(s.lowData),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, session]);
  useEffect(() => {
    const back = () => {
      const name = window.location.pathname.split("/")[1] || "feed";
      setPage(name as Page);
      setProfileUser(null);
      setProfileShowcase(null);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    if (!data.ready) return;
    let active = true;
    const q = new URLSearchParams(window.location.search);
    if (initialPage === "title" && q.get("id"))
      client
        .getTitle(q.get("id")!)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((e) => {
          if (active) setToast(e.message);
        });
    if (initialPage === "activity" && q.get("id"))
      client
        .readActivity(q.get("id")!)
        .then((value) => {
          if (active) setDiscussion(value);
        })
        .catch((e) => {
          if (active) setToast(e.message);
        });
    if (initialPage === "profile" && q.get("u")) {
      const id = q.get("u")!;
      client
        .discoverUsers()
        .then(
          (users) =>
            active && setProfileUser(users.find((u) => u.id === id) ?? null),
        );
      client
        .readShowcase(id)
        .then((value) => {
          if (active) setProfileShowcase(value);
        })
        .catch((e) => {
          if (active) setToast(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [data.ready, client, initialPage]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timeout);
  }, [toast]);
  const notify = (msg: string) => setToast(msg);
  const requireAccount = (fn: () => void) => {
    if (!session) setAuth(true);
    else fn();
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      const result = await fn();
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        result.status !== "accepted"
      )
        throw new Error(
          result.status === "conflict"
            ? "Your journal changed. Refresh and review this action."
            : "The action was rejected. Review and try again.",
        );
      notify(msg);
      await data.refresh();
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Could not complete that action. Try again.",
      );
    }
  };
  const go = (next: Page) => {
    scrollPositions.current[page] = window.scrollY;
    setPage(next);
    setMedia("All");
    setSearch("");
    setProfileUser(null);
    setProfileShowcase(null);
    window.history.pushState(null, "", next === "feed" ? "/" : `/${next}/`);
    requestAnimationFrame(() =>
      window.scrollTo({
        top: scrollPositions.current[next] ?? 0,
        behavior: "instant",
      }),
    );
  };
  const openTitle = (t: CatalogHit) => {
    if (t.id !== "hidden") setDetail(t);
  };
  const save = (t: CatalogHit) => {
    if (t.id === "hidden") return;
    if (library.some((i) => i.titleId === t.id)) {
      notify(`${t.title} is already in your library`);
      return;
    }
    return requireAccount(
      () =>
        void run(
          () =>
            client.editLibrary({
              commandId: crypto.randomUUID(),
              titleId: t.id,
              baseVersion:
                library.find((i) => i.titleId === t.id)?.version ?? 0,
              patch: { state: "planned" },
            }),
          `${t.title} saved to your library`,
        ),
    );
  };
  const editItem = (t: CatalogHit, patch: Record<string, unknown>) =>
    requireAccount(
      () =>
        void run(
          () =>
            client.editLibrary({
              commandId: crypto.randomUUID(),
              titleId: t.id,
              baseVersion:
                library.find((i) => i.titleId === t.id)?.version ?? 0,
              patch,
            }),
          "Library updated",
        ),
    );
  const openProfile = (u: User) => {
    if (!u) return;
    setProfileUser(u);
    setPage("profile");
    window.history.pushState(
      null,
      "",
      `/profile/?u=${encodeURIComponent(u.id)}`,
    );
    const owner = accountToken.current;
    client
      .readShowcase(u.id)
      .then((value) => {
        if (owner === accountToken.current) setProfileShowcase(value);
      })
      .catch((e) => {
        if (owner === accountToken.current) notify(e.message);
      });
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const follow = (u: User) =>
    requireAccount(
      () =>
        void run(
          async () => {
            const isFollowing = followed.includes(u.id);
            await client.follow(u.id, !isFollowing);
          },
          followed.includes(u.id)
            ? `Unfollowed ${u.displayName}`
            : `Following ${u.displayName}`,
        ),
    );
  const showDiscussion = (a: Activity) => {
    setDiscussion(a);
    setReplies([]);
    const owner = accountToken.current;
    client
      .readReplies(a.id)
      .then((value) => {
        if (owner === accountToken.current) setReplies(value);
      })
      .catch(() => {
        if (owner === accountToken.current) setReplies([]);
      });
  };
  const activeProfile = profileUser ?? session?.user ?? people[0];
  const activeShowcase = profileUser ? profileShowcase : showcase;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (page !== "discover") return;
      setSearchPending(true);
      try {
        const hits = await client.searchCatalog({
          text: search,
          media:
            media === "All"
              ? undefined
              : media.toLowerCase() === "films"
                ? "movie"
                : media.toLowerCase() === "series"
                  ? "show"
                  : "game",
        });
        if (active) {
          setSearchTitles(hits);
          setSearchError("");
        }
      } catch (e) {
        if (active)
          setSearchError(e instanceof Error ? e.message : "Search unavailable");
      } finally {
        if (active) setSearchPending(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, search, media, client]);
  const filteredCatalog = (searchTitles ?? catalog).filter(
    (t) =>
      (media === "All" ||
        t.media ===
          (media === "Films"
            ? "movie"
            : media === "Series"
              ? "show"
              : "game")) &&
      t.title.toLowerCase().includes(search.toLowerCase()),
  );
  const current = catalog.filter((t) =>
    library.some((i) => i.titleId === t.id && i.state === "active"),
  );
  const railWorks = session ? current : catalog.slice(1, 3);
  return (
    <div className={`app-shell ${page === "profile" ? "profile-page" : ""}`}>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Ludex home">
          ludex
          <FilmSlate size={24} weight="fill" />
        </Link>
        <div className="sidebar-rule" />
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
            >
              <n.icon size={21} weight={page === n.id ? "fill" : "regular"} />
              <span>{n.label}</span>
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <button
          className="log-button"
          onClick={() => requireAccount(() => setLogTitle(catalog[0]))}
        >
          <Plus size={20} /> Log a moment
        </button>
        <div className="sidebar-lounge">
          <span className="lounge-symbol">
            <FilmSlate size={25} />
          </span>
          <p>
            After hours,
            <br />
            together.
          </p>
          <span>Films. Series. Games.</span>
        </div>
        <button className="assistant-entry" onClick={() => setCompanion(true)}>
          <Sparkle size={18} />
          <span>Your companion</span>
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-bottom">
          <button
            className="account-button"
            onClick={() => (session ? go("settings") : setAuth(true))}
          >
            <Avatar
              name={session?.user.displayName ?? "Your journal"}
              size={34}
            />
            <span>
              <strong>
                {session?.user.displayName ?? "Make yourself at home"}
              </strong>
              <small>
                {session ? "Your personal journal" : "Join the private beta"}
              </small>
            </span>
            <GearSix size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            ludex
            <FilmSlate size={19} weight="fill" />
          </div>
          <div className="breadcrumbs">
            {page === "feed"
              ? "The social journal"
              : page === "profile"
                ? "The personal program"
                : page === "library"
                  ? "Your collection"
                  : "Find your next story"}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Search Ludex"
              onClick={() => go("discover")}
            >
              <MagnifyingGlass size={21} />
            </button>
            <button
              className="icon-button notification-trigger"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={20} />
            </button>
            <span className="topbar-divider" />
            {session ? (
              <button
                className="icon-button"
                aria-label="Your profile"
                onClick={() => go("profile")}
              >
                <Avatar name={session.user.displayName} size={29} />
              </button>
            ) : (
              <button
                className="text-button join"
                onClick={() => setAuth(true)}
              >
                Join Ludex <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </header>
        <div
          className={`content-layout ${page === "profile" ? "wide-content" : ""}`}
        >
          <main className="main-content">
            {!session && (
              <div className="preview-label">
                <span className="preview-dot" /> Sample journal{" "}
                <span>
                  Explore the atmosphere. Your own journal starts fresh.
                </span>
                <button onClick={() => setAuth(true)}>
                  Create yours <ArrowUpRight size={12} />
                </button>
              </div>
            )}
            {data.error && (
              <div className="connection-error">
                <WarningCircle size={18} />
                <div>
                  <strong>We couldn’t reach your journal.</strong>
                  <p>
                    {data.error} Start the local API with{" "}
                    <code>pnpm dev:api</code>.
                  </p>
                </div>
                <button onClick={() => void data.refresh()}>Retry</button>
              </div>
            )}
            {page === "feed" && (
              <>
                <PremiereStage
                  mode="feed"
                  artEnabled={artEnabled}
                  catalog={catalog}
                  onTitle={openTitle}
                  onAction={() => requireAccount(() => setLogTitle(catalog[0]))}
                />
                <div className="feed-filter">
                  <div>
                    <button
                      className={
                        data.feedFilter === "following" ? "selected" : ""
                      }
                      onClick={() => data.setFeedFilter("following")}
                    >
                      Following
                    </button>
                    <button
                      className={
                        data.feedFilter === "friends" ? "selected" : ""
                      }
                      onClick={() => data.setFeedFilter("friends")}
                    >
                      Friends
                    </button>
                  </div>
                  <button
                    className="feed-order"
                    onClick={() => void data.refresh()}
                  >
                    Latest first <ArrowDown size={13} />
                  </button>
                </div>
                {session && data.newFeed && (
                  <button className="new-items" onClick={data.acceptNewFeed}>
                    New moments are waiting <ArrowUpRight size={14} />
                  </button>
                )}
                <Feed
                  items={feed}
                  people={people}
                  onTitle={openTitle}
                  onProfile={openProfile}
                  onSave={save}
                  onReact={(a) =>
                    requireAccount(
                      () =>
                        void run(
                          () => client.react(a.id, !a.likedByViewer),
                          a.likedByViewer
                            ? "Reaction removed"
                            : "A little appreciation, sent",
                        ),
                    )
                  }
                  onDiscuss={showDiscussion}
                  onMenu={setMenuActivity}
                />
              </>
            )}
            {page === "library" && (
              <Library
                catalog={catalog}
                items={library}
                onTitle={openTitle}
                onLog={(t) => requireAccount(() => setLogTitle(t))}
                onEdit={editItem}
                isPreview={!session}
              />
            )}
            {page === "profile" && activeProfile && (
              <Profile
                user={activeProfile}
                showcase={activeShowcase}
                catalog={catalog}
                owner={!profileUser || profileUser.id === session?.user.id}
                onEdit={() => requireAccount(() => setEditing(true))}
                onTitle={openTitle}
                onFollow={() => follow(activeProfile)}
                following={followed.includes(activeProfile.id)}
                friendship={data.social[activeProfile.id]?.friendship}
                onFriend={(action) =>
                  requireAccount(
                    () =>
                      void run(
                        () => client.setFriendship(activeProfile.id, action),
                        action === "accept"
                          ? "You are now friends"
                          : action === "remove"
                            ? "Friendship removed"
                            : "Friend request sent",
                      ),
                  )
                }
                viewerId={session?.user.id}
                onCollections={() => go("collection")}
              />
            )}
            {page === "discover" && (
              <>
                <PremiereStage
                  mode="discover"
                  artEnabled={artEnabled}
                  catalog={catalog}
                  onTitle={openTitle}
                  onAction={() =>
                    document
                      .querySelector<HTMLInputElement>(
                        '[aria-label="Search catalog"]',
                      )
                      ?.focus()
                  }
                />
                <label className="search-field">
                  <MagnifyingGlass size={21} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find films, series, games and people"
                    aria-label="Search catalog"
                  />
                  <span>/</span>
                </label>
                <div className="content-toolbar">
                  <div className="segmented">
                    {["All", "Films", "Series", "Games"].map((f) => (
                      <button
                        className={media === f ? "selected" : ""}
                        onClick={() => setMedia(f)}
                        key={f}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="discover-grid">
                  {searchPending ? (
                    <p role="status">Searching the catalog…</p>
                  ) : null}
                  {searchError ? <p role="alert">{searchError}</p> : null}
                  {filteredCatalog.map((t) => (
                    <button
                      className="discover-title"
                      onClick={() => openTitle(t)}
                      key={t.id}
                    >
                      <Artwork title={t} />
                      <strong>{t.title}</strong>
                      <span>
                        {t.year} · {t.media}
                      </span>
                    </button>
                  ))}
                </div>
                <section className="people-section">
                  <div className="section-heading">
                    <h2>Good taste travels.</h2>
                    <span>Find your people</span>
                  </div>
                  {people
                    .filter(
                      (u) =>
                        u.id !== session?.user.id &&
                        u.displayName
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map((u) => (
                      <div className="person-row" key={u.id}>
                        <button onClick={() => openProfile(u)}>
                          <Avatar name={u.displayName} />
                          <span>
                            <strong>{u.displayName}</strong>
                            <small>
                              {u.bio ?? "Collecting stories, one at a time."}
                            </small>
                          </span>
                        </button>
                        <button
                          className="tiny-button"
                          onClick={() => follow(u)}
                        >
                          {followed.includes(u.id) ? (
                            <Check size={13} />
                          ) : (
                            <Plus size={13} />
                          )}{" "}
                          {followed.includes(u.id) ? "Following" : "Follow"}
                        </button>
                      </div>
                    ))}
                </section>
              </>
            )}
            {page === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>
                      On your terms<span>.</span>
                    </h1>
                    <p>Your journal, your boundaries.</p>
                  </div>
                </div>
                {session ? (
                  <div className="settings-list">
                    <section>
                      <h2>Comfort & preferences</h2>
                      <label>
                        Home region
                        <select
                          value={String(settings.region ?? "US")}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              region: e.target.value,
                            }))
                          }
                        >
                          <option value="US">United States</option>
                          <option value="GB">United Kingdom</option>
                          <option value="IN">India</option>
                          <option value="CA">Canada</option>
                          <option value="AU">Australia</option>
                        </select>
                      </label>
                      <label>
                        <span>Low-data artwork</span>
                        <input
                          type="checkbox"
                          checked={Boolean(settings.lowData)}
                          onChange={(e) => {
                            setSettings((s) => ({
                              ...s,
                              lowData: e.target.checked,
                            }));
                            document.documentElement.classList.toggle(
                              "low-data",
                              e.target.checked,
                            );
                          }}
                        />
                      </label>
                      <label>
                        <span>Reduce motion</span>
                        <input
                          type="checkbox"
                          checked={Boolean(settings.reducedMotion)}
                          onChange={(e) => {
                            setSettings((s) => ({
                              ...s,
                              reducedMotion: e.target.checked,
                            }));
                            document.documentElement.classList.toggle(
                              "reduce-motion",
                              e.target.checked,
                            );
                          }}
                        />
                      </label>
                      <button
                        className="button"
                        onClick={() =>
                          void run(
                            () => client.saveSettings(settings),
                            "Preferences saved",
                          )
                        }
                      >
                        Save preferences
                      </button>
                    </section>
                    <section>
                      <h2>Your data belongs to you</h2>
                      <p>
                        Export your library, logs, reviews and source records.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() =>
                          void run(async () => {
                            const result = await client.exportAccount();
                            const payload = await client.request(
                              "/account/download?id=" +
                                encodeURIComponent(result.downloadId),
                            );
                            const url = URL.createObjectURL(
                              new Blob([JSON.stringify(payload, null, 2)], {
                                type: "application/json",
                              }),
                            );
                            const anchor = document.createElement("a");
                            anchor.href = url;
                            anchor.download = "ludex-journal.json";
                            anchor.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }, "Your export is ready")
                        }
                      >
                        Export my journal <ArrowUpRight size={16} />
                      </button>
                    </section>
                    <section>
                      <h2>Bring your world together</h2>
                      <p>
                        Import the journal you already keep. Plan the next story
                        with your friends.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => setConnections(true)}
                      >
                        Connections & imports <ArrowUpRight size={16} />
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => go("plan")}
                      >
                        Shared watch & play plans <ArrowUpRight size={16} />
                      </button>
                    </section>
                    <section>
                      <h2>Account</h2>
                      {session.user.roles.includes("moderator") && (
                        <button
                          className="button secondary"
                          onClick={() => go("moderation")}
                        >
                          Open moderation workspace
                        </button>
                      )}
                      <button
                        className="button secondary"
                        onClick={() => {
                          setDiscussion(null);
                          setReplies([]);
                          setProfileUser(null);
                          setProfileShowcase(null);
                          setReviewTitle(null);
                          setLogTitle(null);
                          setUndo(null);
                          setMenuActivity(null);
                          setEditing(false);
                          setSettings({});
                          document.documentElement.classList.remove(
                            "reduce-motion",
                            "low-data",
                          );
                          void data
                            .logout()
                            .catch(() =>
                              notify(
                                "Signed out locally. Session revocation could not reach the server.",
                              ),
                            );
                        }}
                      >
                        <SignOut size={16} /> Sign out
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete your account and journal? This cannot be undone.",
                            )
                          )
                            void run(async () => {
                              await client.requestDeletion();
                              await data.logout();
                            }, "Account deleted");
                        }}
                      >
                        Delete my account
                      </button>
                    </section>
                  </div>
                ) : (
                  <Empty
                    title="A space of your own."
                    description="Sign in to manage your journal and preferences."
                    action={
                      <button className="button" onClick={() => setAuth(true)}>
                        Join Ludex
                      </button>
                    }
                  />
                )}
              </>
            )}
            {page === "moderation" && (
              <Moderation
                client={client}
                allowed={Boolean(session?.user.roles.includes("moderator"))}
              />
            )}
            {page === "plan" && (
              <Plans
                client={client}
                signedIn={Boolean(session)}
                sessionKey={session?.user.id ?? null}
                catalog={catalog}
                onSignIn={() => setAuth(true)}
              />
            )}
            {page === "collection" && (
              <Collections
                client={client}
                catalog={catalog}
                signedIn={Boolean(session)}
                onJoin={() => setAuth(true)}
                onTitle={openTitle}
              />
            )}
            <footer className="journal-footer">
              <span>ludex</span>
              <p>Your film, series and game journal.</p>
              <small>
                Invited beta · Films, series & games ·{" "}
                <Link href="/privacy/">Privacy</Link>
              </small>
            </footer>
          </main>
          {page !== "profile" && (
            <aside className="right-rail">
              <div className="rail-heading">
                <h2>In progress</h2>
                <span>{session ? "From your library" : "Sample library"}</span>
              </div>
              {railWorks.length ? (
                railWorks.map((t) => (
                  <button
                    className="current-work"
                    key={t.id}
                    onClick={() => openTitle(t)}
                  >
                    <Artwork title={t} />
                    <div>
                      <span className="current-type">
                        {t.media === "game" ? (
                          <GameController size={13} />
                        ) : (
                          <Television size={13} />
                        )}{" "}
                        {t.media === "game" ? "Playing" : "Watching"}
                      </span>
                      <h3>{t.title}</h3>
                      <p>
                        {t.year} ·{" "}
                        {t.genres?.slice(0, 2).join(" / ") ?? t.media}
                      </p>
                      <span className="continue-text">
                        Continue your journal <ArrowRight size={13} />
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <p className="rail-empty">
                  Your current stories will live here. Log something to begin.
                </p>
              )}
              <div className="rail-divider" />
              <div className="rail-heading">
                <h2>Taste worth following</h2>
                <button onClick={() => go("discover")}>
                  Explore <ArrowUpRight size={13} />
                </button>
              </div>
              {people
                .slice(0, 3)
                .filter((u) => u.id !== session?.user.id)
                .map((u) => (
                  <div className="rail-person" key={u.id}>
                    <button onClick={() => openProfile(u)}>
                      <Avatar name={u.displayName} size={34} />
                      <span>
                        <strong>{u.displayName}</strong>
                        <small>
                          {u.bio?.slice(0, 36) ?? "A fellow story collector"}
                        </small>
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => follow(u)}
                      aria-label={`Follow ${u.displayName}`}
                    >
                      {followed.includes(u.id) ? (
                        <Check size={15} />
                      ) : (
                        <Plus size={15} />
                      )}
                    </button>
                  </div>
                ))}
              <div
                className="lounge-invite"
                style={{
                  backgroundImage: artEnabled
                    ? "linear-gradient(180deg,transparent,#160d20),url(/art/premiere.webp)"
                    : undefined,
                }}
              >
                <FilmSlate size={23} />
                <h3>Find your people.</h3>
                <p>
                  Explore their showcases. Compare notes. Start a conversation.
                </p>
                <button onClick={() => go("discover")}>
                  Find your people <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="rail-links">
                <button onClick={() => go("settings")}>
                  Privacy & settings
                </button>
                <span>·</span>
                <button onClick={() => setCompanion(true)}>
                  About the beta
                </button>
              </div>
              <div className="rail-copyright">© 2026 Ludex. Stay curious.</div>
            </aside>
          )}
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            onClick={() => go(n.id)}
          >
            <n.icon size={22} weight={page === n.id ? "fill" : "regular"} />
            <span>{n.label}</span>
          </button>
        ))}
        <button
          className="mobile-log"
          aria-label="Log a moment"
          onClick={() => requireAccount(() => setLogTitle(catalog[0]))}
        >
          <Plus size={24} />
        </button>
      </nav>
      <AuthForm
        open={auth}
        onClose={() => setAuth(false)}
        onSubmit={data.authenticate}
        busy={data.busy}
      />
      {logTitle && (
        <LogForm
          title={logTitle}
          item={library.find((i) => i.titleId === logTitle.id)}
          onClose={() => setLogTitle(null)}
          onSubmit={async (input) => {
            const result = await client.applyProgress(
              makeLog(
                logTitle,
                library.find((i) => i.titleId === logTitle.id),
                input,
              ),
            );
            if (result.status !== "accepted")
              throw new Error(
                result.status === "conflict"
                  ? "Your journal changed. Refresh and try again."
                  : result.code,
              );
            setUndo({
              eventId: result.eventId,
              titleId: logTitle.id,
              version: result.version,
            });
            notify(
              input.audience === "private"
                ? "A moment saved, just for you."
                : "Your moment is in the journal.",
            );
            await data.refresh();
          }}
        />
      )}
      {editing && session && showcase && (
        <ShowcaseEditor
          showcase={showcase}
          catalog={catalog}
          onClose={() => setEditing(false)}
          onSave={async (s) => {
            const result = await client.saveShowcase({
              commandId: crypto.randomUUID(),
              baseVersion: showcase.version,
              showcase: s,
            });
            if (result.status !== "accepted")
              throw new Error("Your showcase changed. Refresh and try again.");
            notify("Your showcase, beautifully yours.");
            await data.refresh();
          }}
        />
      )}
      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={detail.title}
          description={`${detail.year ?? ""} · ${detail.genres?.join(" / ") ?? detail.media}`}
          wide
        >
          <div className="title-backdrop">
            <Artwork title={detail} backdrop />
          </div>
          <p className="title-synopsis">
            {detail.synopsis ??
              "A story to make your own. Save it, log a moment, or add it to your personal program."}
          </p>
          <div className="title-actions">
            <button
              className="button"
              onClick={() => {
                const t = detail;
                setDetail(null);
                requireAccount(() => setLogTitle(t));
              }}
            >
              <Plus size={17} /> Log{" "}
              {detail.media === "show"
                ? "episode"
                : detail.media === "game"
                  ? "session"
                  : "film"}
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const t = detail;
                setDetail(null);
                requireAccount(() => setReviewTitle(t));
              }}
            >
              Write a review
            </button>
            <button className="button secondary" onClick={() => save(detail)}>
              <BookmarkSimple size={17} /> Save for later
            </button>
          </div>
          <div className="title-context">
            <LockSimple size={16} />
            <p>Your progress stays private until you choose to share.</p>
          </div>
        </Modal>
      )}
      {discussion && (
        <Modal
          open
          onClose={() => setDiscussion(null)}
          title="Around this story"
          description={
            discussion.detailHidden
              ? "Details remain hidden at your progress boundary."
              : discussion.title.title
          }
        >
          <div className="discussion-original">
            <Avatar name={discussion.author.displayName} />
            <p>
              {discussion.detailHidden
                ? "A spoiler-safe moment."
                : (discussion.note ?? discussion.caption)}
            </p>
          </div>
          {replies.map((r) => (
            <div className="reply" key={r.id}>
              <Avatar name={r.author.displayName} size={30} />
              <div>
                <strong>{r.author.displayName}</strong>
                <p>{r.detailHidden ? "Reply hidden for spoilers" : r.text}</p>
              </div>
            </div>
          ))}
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!session) {
                setAuth(true);
                return;
              }
              if (replyPending.current) return;
              replyPending.current = true;
              setReplyBusy(true);
              const owner = session.token;
              const form = e.currentTarget;
              const f = new FormData(form);
              try {
                await client.addReply({
                  commandId: crypto.randomUUID(),
                  activityId: discussion.id,
                  text: String(f.get("reply")),
                  spoiler: discussion.spoiler,
                });
                const updated = await client.readReplies(discussion.id);
                if (accountToken.current !== owner) return;
                setReplies(updated);
                form.reset();
              } catch (err) {
                notify(
                  err instanceof Error ? err.message : "Could not send reply",
                );
              } finally {
                replyPending.current = false;
                setReplyBusy(false);
              }
            }}
          >
            <label>
              Your reply
              <textarea
                name="reply"
                required
                maxLength={2000}
                placeholder="A thought, a feeling, a recommendation…"
              />
            </label>
            <button className="button" disabled={replyBusy}>
              {replyBusy ? "Sending…" : "Send reply"} <ArrowUpRight size={15} />
            </button>
          </form>
        </Modal>
      )}
      {menuActivity && (
        <Modal
          open
          onClose={() => setMenuActivity(null)}
          title="This moment"
          description="Keep your corner of Ludex comfortable."
        >
          <div className="menu-actions">
            <button
              onClick={() =>
                requireAccount(
                  () =>
                    void run(
                      () => client.blockUser(menuActivity.authorId),
                      "Account blocked",
                    ),
                )
              }
            >
              <LockSimple size={17} /> Block account
            </button>
            <button
              onClick={() =>
                requireAccount(
                  () =>
                    void run(
                      () =>
                        client.reportContent({
                          targetId: menuActivity.id,
                          reason: "spoiler",
                        }),
                      "Report submitted",
                    ),
                )
              }
            >
              <WarningCircle size={17} /> Report spoiler or problem
            </button>
          </div>
        </Modal>
      )}
      <Modal
        open={connections}
        onClose={() => setConnections(false)}
        title="Every story, in one place."
        description="Preview imports and confirm captures before they change your journal."
        wide
      >
        <Connections
          catalog={catalog}
          client={client}
          signedIn={Boolean(session)}
          sessionKey={session?.user.id ?? null}
          onSignIn={() => {
            setConnections(false);
            setAuth(true);
          }}
        />
      </Modal>
      <Modal
        open={companion}
        onClose={() => setCompanion(false)}
        title="A companion for your curiosity."
        description="Recommendations rooted in your journal. Every change waits for your confirmation."
        wide
      >
        <Companion
          key={session?.user.id ?? "guest"}
          client={client}
          signedIn={Boolean(session)}
          sessionKey={session?.user.id ?? null}
          onSignIn={() => {
            setCompanion(false);
            setAuth(true);
          }}
          onConfirmed={async () => {
            await data.refresh();
          }}
          onTitle={(titleId) => {
            setCompanion(false);
            const title = catalog.find((entry) => entry.id === titleId);
            if (title) openTitle(title);
            else
              void client
                .getTitle(titleId)
                .then(openTitle)
                .catch((error) => notify(error.message));
          }}
        />
      </Modal>
      <Modal
        open={notifications}
        onClose={() => setNotifications(false)}
        title="The quiet corner."
        description="Direct interactions come first. Ordinary progress stays in your feed."
      >
        {!session ? (
          <Empty
            title="Your invitations live here."
            description="Sign in to see direct interactions."
          />
        ) : inboxError ? (
          <p role="alert">{inboxError}</p>
        ) : inbox.length ? (
          <div className="activity-list">
            {inbox.map((item) => (
              <article key={item.id} className="journal-section">
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                <h3>{item.body.title ?? item.kind.replaceAll("-", " ")}</h3>
                {item.body.planId ? (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setNotifications(false);
                      go("plan");
                    }}
                  >
                    Open shared plans <ArrowUpRight size={16} />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="You’re all caught up."
            description="Shared-plan invitations appear here. Ordinary progress stays in your feed."
          />
        )}
      </Modal>
      {reviewTitle && (
        <ReviewEditor
          title={reviewTitle}
          client={client}
          onClose={() => setReviewTitle(null)}
          onPublished={() => {
            notify("Your review is published.");
            void data.refresh();
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          {undo && (
            <button
              className="text-button"
              onClick={() =>
                void run(async () => {
                  const r = await client.correctProgress({
                    commandId: crypto.randomUUID(),
                    eventId: undo.eventId,
                    baseVersion:
                      library.find((i) => i.titleId === undo.titleId)
                        ?.version ?? undo.version,
                    retract: true,
                  });
                  if (r.status !== "accepted")
                    throw new Error("This log changed. Refresh before undo.");
                  setUndo(null);
                }, "Log undone")
              }
            >
              Undo log
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
