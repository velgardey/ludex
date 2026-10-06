"use client";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  Trash,
  LockSimple,
} from "@phosphor-icons/react";
import type { CatalogHit, LibraryItem, Showcase } from "@ludex/client";
import { nextUnwatched } from "../commands";
import { Modal, Artwork } from "./Primitives";
export function AuthForm({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    mode: "signup" | "login",
    fields: {
      email: string;
      password: string;
      displayName: string;
      inviteCode: string;
    },
  ) => Promise<void>;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"signup" | "login">("signup"),
    [error, setError] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "signup" ? "Your stories belong here." : "Welcome back."}
      description="Create your journal and find your people."
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await onSubmit(mode, {
              email: String(f.get("email")),
              password: String(f.get("password")),
              displayName: String(f.get("displayName") ?? ""),
              inviteCode: String(f.get("inviteCode") ?? ""),
            });
            onClose();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Sign-in failed. Try again.",
            );
          }
        }}
      >
        {mode === "signup" && (
          <label>
            Your name
            <input
              name="displayName"
              required
              placeholder="What should we call you?"
              autoComplete="nickname"
            />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={mode === "signup" ? 12 : 1}
            required
            placeholder={
              mode === "signup" ? "At least 12 characters" : "Your password"
            }
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
          />
        </label>
        {mode === "signup" && (
          <label>
            Invite code
            <input
              name="inviteCode"
              required
              placeholder="Your beta invitation"
              defaultValue="LUDEX-LOCAL-BETA"
            />
            <small>
              Local development invitation. Cloud invitations are configured
              separately.
            </small>
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button full" disabled={busy}>
          {busy
            ? "Opening your journal…"
            : mode === "signup"
              ? "Create my journal"
              : "Sign in"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup"
            ? "Already have a journal? Sign in"
            : "New here? Create a journal"}
        </button>
      </form>
    </Modal>
  );
}
export function LogForm({
  title,
  item,
  onClose,
  onSubmit,
}: {
  title: CatalogHit;
  item?: LibraryItem;
  onClose: () => void;
  onSubmit: (input: {
    note?: string;
    rating?: number;
    minutes?: number;
    audience: "private" | "public" | "friends";
    episodeId?: string;
    complete?: boolean;
  }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={
        title.media === "show"
          ? "Log an episode"
          : title.media === "game"
            ? "Log a game session"
            : "Log a film"
      }
      description="A moment for your journal. Share only what you choose."
    >
      <div className="form-title">
        <Artwork title={title} />
        <div>
          <h3>{title.title}</h3>
          <p>
            {title.year} ·{" "}
            {title.media === "game"
              ? "Game"
              : title.media === "show"
                ? "Series"
                : "Film"}
          </p>
        </div>
      </div>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await onSubmit({
              note: String(f.get("note") ?? ""),
              rating: f.get("rating") ? Number(f.get("rating")) : undefined,
              minutes: Number(f.get("minutes") ?? 60),
              audience: f.get("audience") as "private" | "public" | "friends",
              episodeId: String(f.get("episodeId") ?? "") || undefined,
              complete: f.get("complete") === "on",
            });
            onClose();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not save your log. Try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {title.media === "show" && (
          <label>
            Episode
            <select
              name="episodeId"
              defaultValue={nextUnwatched(
                title,
                item?.runs[0]?.watchedEpisodeIds ?? [],
                item?.runs[0]?.skippedEpisodeIds ?? [],
              )}
            >
              {title.episodes?.map((e) => (
                <option
                  value={e.id}
                  key={e.id}
                  disabled={
                    !e.releasedAt || e.releasedAt > new Date().toISOString()
                  }
                >
                  S{e.season ?? 1} · E{e.number ?? e.order} ·{" "}
                  {e.title ?? "Episode"}
                </option>
              ))}
            </select>
          </label>
        )}
        {title.media === "game" && (
          <div className="form-row">
            <label>
              Session length
              <input
                name="minutes"
                type="number"
                min={1}
                max={1440}
                defaultValue={60}
              />
              <small>Minutes, entered by you</small>
            </label>
            <label className="checkbox-label">
              <input name="complete" type="checkbox" /> Story completed
            </label>
          </div>
        )}
        <div className="form-row">
          <label>
            Rating <span className="optional">optional</span>
            <select name="rating" defaultValue="">
              <option value="">No rating</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} / 10
                </option>
              ))}
            </select>
          </label>
          <label>
            Audience
            <select name="audience" defaultValue="private">
              <option value="private">Only me</option>
              <option value="public">Public</option>
              <option value="friends">Friends</option>
            </select>
          </label>
        </div>
        <label>
          Your note <span className="optional">optional</span>
          <textarea
            name="note"
            placeholder="What stayed with you?"
            maxLength={4000}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button disabled={busy} className="button full">
          <Check size={17} />
          {busy ? "Saving…" : "Save to journal"}
        </button>
        <p className="form-footnote">
          <LockSimple size={13} /> Private unless you choose to share.
        </p>
      </form>
    </Modal>
  );
}
export function ShowcaseEditor({
  showcase,
  catalog,
  onClose,
  onSave,
}: {
  showcase: Showcase;
  catalog: CatalogHit[];
  onClose: () => void;
  onSave: (s: Showcase) => Promise<void>;
}) {
  const [draft, setDraft] = useState(showcase),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editShelf = (id: string, patch: object) =>
    setDraft((d) => ({
      ...d,
      shelves: d.shelves.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  return (
    <Modal
      open
      onClose={onClose}
      title="Set the scene."
      description="Curate your featured work and shelves. Public shelves disclose the titles you select."
      wide
    >
      <div className="form-stack">
        <label>
          Your atmosphere
          <div className="theme-options">
            {(["lounge", "matinee", "midnight"] as const).map((t) => (
              <button
                className={draft.theme === t ? "active" : ""}
                key={t}
                onClick={() => setDraft((d) => ({ ...d, theme: t }))}
              >
                <span className={`theme-swatch ${t}`} />
                {t}
                <span>{draft.theme === t && <Check size={14} />}</span>
              </button>
            ))}
          </div>
        </label>
        <label>
          Featured work
          <select
            value={draft.featuredTitleId ?? ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, featuredTitleId: e.target.value }))
            }
          >
            <option value="">No featured work</option>
            {catalog.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        {draft.shelves.map((s, index) => (
          <div className="shelf-edit" key={s.id}>
            <div className="shelf-edit-heading">
              <input
                aria-label="Shelf title"
                value={s.title}
                onChange={(e) => editShelf(s.id, { title: e.target.value })}
              />
              <button
                className="icon-button"
                disabled={index === 0}
                aria-label="Move shelf up"
                onClick={() =>
                  setDraft((d) => {
                    const ss = [...d.shelves];
                    [ss[index], ss[index - 1]] = [ss[index - 1], ss[index]];
                    return { ...d, shelves: ss };
                  })
                }
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon-button"
                disabled={index === draft.shelves.length - 1}
                aria-label="Move shelf down"
                onClick={() =>
                  setDraft((d) => {
                    const ss = [...d.shelves];
                    [ss[index], ss[index + 1]] = [ss[index + 1], ss[index]];
                    return { ...d, shelves: ss };
                  })
                }
              >
                <ArrowDown size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Remove shelf"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    shelves: d.shelves.filter((x) => x.id !== s.id),
                  }))
                }
              >
                <Trash size={16} />
              </button>
            </div>
            <div className="form-row">
              <label>
                Layout
                <select
                  value={s.layout}
                  onChange={(e) => editShelf(s.id, { layout: e.target.value })}
                >
                  <option value="covers">Cover shelf</option>
                  <option value="spread">Cinematic spread</option>
                  <option value="milestones">Milestones</option>
                </select>
              </label>
              <label>
                Audience
                <select
                  value={s.audience.kind}
                  onChange={(e) =>
                    editShelf(s.id, { audience: { kind: e.target.value } })
                  }
                >
                  <option value="public">Public</option>
                  <option value="private">Only me</option>
                  <option value="friends">Friends</option>
                </select>
              </label>
            </div>
            <div className="shelf-title-picker">
              {catalog.map((t) => (
                <button
                  aria-label={t.title}
                  className={s.itemIds.includes(t.id) ? "chosen" : ""}
                  key={t.id}
                  onClick={() =>
                    editShelf(s.id, {
                      itemIds: s.itemIds.includes(t.id)
                        ? s.itemIds.filter((id) => id !== t.id)
                        : [...s.itemIds, t.id],
                    })
                  }
                >
                  <Artwork title={t} />
                  <span>{t.title}</span>
                  {s.itemIds.includes(t.id) && <Check size={16} />}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          className="button secondary"
          disabled={draft.shelves.length >= 8}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              shelves: [
                ...d.shelves,
                {
                  id: crypto.randomUUID(),
                  title: "New shelf",
                  layout: "covers",
                  itemIds: [],
                  audience: { kind: "public" },
                },
              ],
            }))
          }
        >
          <Plus size={17} /> Add a shelf
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(draft);
                onClose();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not save. Try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save showcase"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
