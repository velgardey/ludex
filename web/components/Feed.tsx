"use client";
import {
  ArrowUpRight,
  BookmarkSimple,
  ChatCircle,
  Heart,
  LockSimple,
  Play,
  Star,
  DotsThree,
} from "@phosphor-icons/react";
import type { Activity, CatalogHit, User } from "@ludex/client";
import { useReveal } from "../hooks/useReveal";
import { Avatar, Artwork, Empty } from "./Primitives";
export function Feed({
  items,
  people,
  onTitle,
  onProfile,
  onSave,
  onReact,
  onDiscuss,
  onMenu,
}: {
  items: Activity[];
  people: User[];
  onTitle: (t: CatalogHit) => void;
  onProfile: (u: User) => void;
  onSave: (t: CatalogHit) => void;
  onReact: (a: Activity) => void;
  onDiscuss: (a: Activity) => void;
  onMenu: (a: Activity) => void;
}) {
  const root = useReveal(items.map(item => item.id).join(","));
  if (!items.length)
    return (
      <Empty
        title="Your circle, unfolding."
        description="Follow someone whose taste you trust. Their shared moments will find a home here."
      />
    );
  return (
    <div className="activity-list" ref={root}>
      {items.map((a, index) => {
        const spread = index === 0 && !a.detailHidden;
        return (
          <article
            className={`activity ${spread ? "session-spread" : ""}`}
            key={a.id}
          >
            <div className="activity-byline">
              <button
                className="person-button"
                onClick={() =>
                  onProfile(
                    a.author ?? people.find((p) => p.id === a.authorId)!,
                  )
                }
              >
                <Avatar name={a.author?.displayName ?? "Member"} />
                <span>
                  <strong>{a.author?.displayName ?? "Member"}</strong>
                  <small>{a.caption}</small>
                </span>
              </button>
              <span className="event-time">
                {a.sample
                  ? "Yesterday"
                  : a.occurredAt.precision === "instant"
                    ? new Date(a.occurredAt.iso).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                      })
                    : "Logged"}
              </span>
              <button
                className="icon-button"
                aria-label="Activity options"
                onClick={() => onMenu(a)}
              >
                <DotsThree size={23} />
              </button>
            </div>
            {spread ? (
              <button className="spread-art" onClick={() => onTitle(a.title)}>
                <Artwork title={a.title} backdrop />
                <div className="spread-vignette" />
                <span className="spread-info">
                  <span className="media-label">
                    <Play size={13} weight="fill" />
                    {a.title.media === "show"
                      ? "EPISODE JOURNAL"
                      : a.title.media === "game"
                        ? "PLAY JOURNAL"
                        : "FILM JOURNAL"}
                  </span>
                  <h2>{a.title.title}</h2>
                  <span className="spread-meta">
                    {a.title.year} <span>·</span>{" "}
                    {a.title.genres?.slice(0, 2).join(" / ") ?? a.title.media}
                  </span>
                </span>
                <span className="art-open">
                  <ArrowUpRight size={22} />
                </span>
              </button>
            ) : (
              <div className="compact-work">
                <button
                  disabled={a.title.id === "hidden"}
                  className="compact-cover"
                  onClick={() => onTitle(a.title)}
                >
                  <Artwork title={a.title} />
                </button>
                <div>
                  <button
                    disabled={a.title.id === "hidden"}
                    className="work-title"
                    onClick={() => onTitle(a.title)}
                  >
                    {a.detailHidden
                      ? "A moment, kept spoiler-safe"
                      : a.title.title}
                  </button>
                  <p className="work-meta">
                    {a.detailHidden ? (
                      <>
                        <LockSimple size={13} /> Details hidden until you’re
                        ready
                      </>
                    ) : (
                      <>
                        {a.title.year} ·{" "}
                        {a.title.media === "game"
                          ? "Game"
                          : a.title.media === "show"
                            ? "Series"
                            : "Film"}
                      </>
                    )}
                  </p>
                  {a.note && !a.detailHidden && (
                    <p className="activity-note">{a.note}</p>
                  )}
                  {a.rating && (
                    <div className="rating">
                      <Star size={13} weight="fill" />
                      {a.rating}
                      <span>/ 10</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {spread && (
              <div className="spread-note">
                <span className="quote-mark">“</span>
                <p>{a.note ?? "Another story that stays with you."}</p>
                {a.rating && (
                  <span className="rating">
                    <Star size={14} weight="fill" />
                    {a.rating}
                    <span>/ 10</span>
                  </span>
                )}
              </div>
            )}
            <div className="activity-actions">
              <button
                className={a.likedByViewer ? "is-liked" : ""}
                onClick={() => onReact(a)}
                aria-label={
                  a.likedByViewer ? "Unlike activity" : "Like activity"
                }
              >
                <Heart
                  size={18}
                  weight={a.likedByViewer ? "fill" : "regular"}
                />
                <span>{a.reactionCount || "Like"}</span>
              </button>
              <button
                onClick={() => onDiscuss(a)}
                aria-label="Discuss activity"
              >
                <ChatCircle size={18} />
                <span>{a.replyCount || "Discuss"}</span>
              </button>
              <button
                disabled={a.title.id === "hidden"}
                className="save-action"
                onClick={() => onSave(a.title)}
              >
                <BookmarkSimple size={17} />
                <span>Save for later</span>
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
