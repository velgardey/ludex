"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  PencilSimple,
  ArrowUpRight,
  LockSimple,
} from "@phosphor-icons/react";
import type { CatalogHit, Collection, LudexClient } from "@ludex/client";
import { Artwork, Empty, Modal } from "./Primitives";
export function Collections({
  client,
  catalog,
  signedIn,
  onJoin,
  onTitle,
}: {
  client: LudexClient;
  catalog: CatalogHit[];
  signedIn: boolean;
  onJoin: () => void;
  onTitle: (t: CatalogHit) => void;
}) {
  const [items, setItems] = useState<Collection[]>([]),
    [draft, setDraft] = useState<Collection | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .readCollections()
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [client]);
  const create = () =>
    signedIn
      ? setDraft({
          id: crypto.randomUUID(),
          userId: "",
          version: 0,
          title: "",
          description: "",
          titleIds: [],
          audience: { kind: "private" },
        })
      : onJoin();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Worlds worth keeping<span>.</span>
          </h1>
          <p>Films, series and games, collected around a feeling.</p>
        </div>
      </div>
      <div className="content-toolbar">
        <button className="button" onClick={create}>
          <Plus size={17} />
          Create collection
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!items.length ? (
        <Empty
          title="Give a feeling a home."
          description="Build your first mixed-media collection. You choose its audience."
        />
      ) : (
        items.map((c) => (
          <section className="profile-shelf" key={c.id}>
            <div className="shelf-heading">
              <div>
                <h3>{c.title}</h3>
                <span>
                  {c.titleIds.length} stories · {c.audience.kind}
                </span>
              </div>
              {signedIn && (
                <button
                  className="icon-button"
                  aria-label={`Edit ${c.title}`}
                  onClick={() => setDraft(c)}
                >
                  <PencilSimple size={18} />
                </button>
              )}
            </div>
            <p className="collection-description">{c.description}</p>
            <div className="showcase-covers">
              {c.titleIds.map((id) => {
                const t = catalog.find((t) => t.id === id);
                return (
                  t && (
                    <button key={id} onClick={() => onTitle(t)}>
                      <Artwork title={t} />
                      <strong>{t.title}</strong>
                      <span>{t.year}</span>
                    </button>
                  )
                );
              })}
            </div>
          </section>
        ))
      )}
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title="Collect a world."
          description="A collection can be private, public, or shared with accepted friends."
          wide
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const { userId: _, ...input } = draft;
                void _;
                const r = await client.saveCollection({
                  ...input,
                  commandId: crypto.randomUUID(),
                });
                if (r.status !== "accepted")
                  throw new Error(
                    r.status === "conflict"
                      ? "This collection changed. Reopen it and try again."
                      : r.code,
                  );
                setItems(await client.readCollections());
                setDraft(null);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not save collection.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Collection name
              <input
                required
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                value={draft.description ?? ""}
                maxLength={2000}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            <label>
              Collection audience
              <select
                value={draft.audience.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    audience: {
                      kind: e.target.value as "private" | "public" | "friends",
                    },
                  })
                }
              >
                <option value="private">Only me</option>
                <option value="public">Public</option>
                <option value="friends">Friends</option>
              </select>
            </label>
            <div className="shelf-title-picker">
              {catalog.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  aria-label={`Choose ${t.title}`}
                  className={draft.titleIds.includes(t.id) ? "chosen" : ""}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      titleIds: draft.titleIds.includes(t.id)
                        ? draft.titleIds.filter((id) => id !== t.id)
                        : [...draft.titleIds, t.id],
                    })
                  }
                >
                  <Artwork title={t} />
                  <span>{t.title}</span>
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Save collection"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ReviewEditor({
  title,
  client,
  onClose,
  onPublished,
}: {
  title: CatalogHit;
  client: LudexClient;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [draft, setDraft] = useState({
      id: crypto.randomUUID(),
      version: 0,
      text: "",
      rating: "",
    }),
    [audience, setAudience] = useState<"private" | "public" | "friends">(
      "private",
    ),
    [spoiler, setSpoiler] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [publishId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    client
      .readReviewDrafts()
      .then((all) => {
        const d = all.find((d) => d.titleId === title.id);
        if (d) {
          setDraft({ ...d, rating: String(d.rating ?? "") });
          setSaved(true);
        }
      })
      .catch(() => {});
  }, [client, title.id]);
  const save = async () => {
    const r = await client.saveReviewDraft({
      id: draft.id,
      version: draft.version,
      titleId: title.id,
      text: draft.text,
      rating: draft.rating ? Number(draft.rating) : undefined,
    });
    setDraft((d) => ({ ...d, version: r.version }));
    setSaved(true);
    return r.version;
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Let it be your words."
      description={`Your review of ${title.title}. Drafts stay private until you publish.`}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const v = await save();
            await client.publishReview({
              commandId: publishId,
              draftId: draft.id,
              baseVersion: v,
              audience: { kind: audience },
              spoiler: spoiler
                ? { kind: "hidden", titleId: title.id }
                : { kind: "none" },
            });
            onPublished();
            onClose();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Publication failed. Your draft is safe.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Your review
          <textarea
            required
            maxLength={4000}
            value={draft.text}
            onChange={(e) => {
              setDraft({ ...draft, text: e.target.value });
              setSaved(false);
            }}
            placeholder="What did it leave with you?"
          />
        </label>
        <div className="form-row">
          <label>
            Review rating
            <select
              value={draft.rating}
              onChange={(e) => {
                setDraft({ ...draft, rating: e.target.value });
                setSaved(false);
              }}
            >
              <option value="">No rating</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} / 10
                </option>
              ))}
            </select>
          </label>
          <label>
            Review audience
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as typeof audience)}
            >
              <option value="private">Only me</option>
              <option value="public">Public</option>
              <option value="friends">Friends</option>
            </select>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
          />
          Hide spoiler details
        </label>
        {saved && (
          <p className="draft-status">
            <LockSimple size={14} />
            Private draft saved
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy || !draft.text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await save();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Draft not saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save private draft
          </button>
          <button className="button" disabled={busy || !draft.text.trim()}>
            {busy ? "Saving…" : "Publish review"}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Moderation({
  client,
  allowed,
}: {
  client: LudexClient;
  allowed: boolean;
}) {
  const [reports, setReports] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (allowed)
      client
        .moderation()
        .then(setReports)
        .catch((e) => setError(e.message));
  }, [client, allowed]);
  if (!allowed)
    return (
      <Empty
        title="Moderation workspace"
        description="A server-verified moderator account is required to view reports."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Keep the lounge welcoming<span>.</span>
          </h1>
          <p>Every moderation action records an audit trail.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!reports.length ? (
        <Empty
          title="No reports in the queue."
          description="New reports will appear here for review."
        />
      ) : (
        reports.map((r) => (
          <section className="moderation-row" key={String(r.reportId)}>
            <h3>{String(r.reason)}</h3>
            <p>{String(r.note ?? "No additional note")}</p>
            <small>{String(r.targetId)}</small>
            <div className="title-actions">
              {(["remove", "suspend"] as const).map((action) => (
                <button
                  className="button secondary"
                  key={action}
                  onClick={async () => {
                    const reason = prompt(
                      `Reason to ${action === "remove" ? "remove this activity" : "suspend this account"}:`,
                    );
                    if (!reason) return;
                    try {
                      await client.moderationAction({
                        targetId: String(r.targetId),
                        action,
                        reason,
                      });
                      setReports(await client.moderation());
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Action failed",
                      );
                    }
                  }}
                >
                  {action === "remove" ? "Remove activity" : "Suspend account"}
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
