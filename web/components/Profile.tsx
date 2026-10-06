"use client";
import {
  ArrowUpRight,
  BookmarkSimple,
  Plus,
  PencilSimple,
  FilmSlate,
  GameController,
  Television,
} from "@phosphor-icons/react";
import type { CatalogHit, Showcase, User } from "@ludex/client";
import { Artwork, Avatar } from "./Primitives";
export function Profile({
  user,
  showcase,
  catalog,
  owner,
  onEdit,
  onTitle,
  onFollow,
  following = false,
  friendship,
  onFriend,
  viewerId,
  onCollections,
}: {
  user: User;
  showcase: Showcase | null;
  catalog: CatalogHit[];
  owner: boolean;
  onEdit: () => void;
  onTitle: (t: CatalogHit) => void;
  onFollow: () => void;
  following?: boolean;
  friendship?: unknown;
  onFriend?: (action: "request" | "accept" | "remove") => void;
  viewerId?: string;
  onCollections?: () => void;
}) {
  const featured = catalog.find((t) => t.id === showcase?.featuredTitleId) ?? {
    id: "unfeatured",
    media: "movie" as const,
    title: "",
    providerIds: {},
  };
  const friend = friendship as { status?: string; requestedBy?: string } | null;
  return (
    <div className={`profile-world theme-${showcase?.theme ?? "lounge"}`}>
      <div className="profile-cinema">
        <Artwork title={featured} backdrop />
        <div className="profile-vignette" />
        <div className="profile-cinema-caption">
          <BookmarkSimple size={17} />
          <span>A collection of things that stay.</span>
        </div>
      </div>
      <div className="profile-header">
        <Avatar name={user.displayName} size={86} />
        <div className="profile-identity">
          <h1>{user.displayName}</h1>
          <p>
            {user.bio ?? "Your personal journal of films, series and games."}
          </p>
          <div className="profile-interests">
            <FilmSlate size={15} /> Film <Television size={15} /> Series{" "}
            <GameController size={15} /> Games
          </div>
        </div>
        <button
          className="button secondary"
          onClick={owner ? onEdit : onFollow}
        >
          {owner ? (
            <>
              <PencilSimple size={16} /> Edit showcase
            </>
          ) : (
            <>
              <Plus size={16} /> {following ? "Following" : "Follow"}
            </>
          )}
        </button>
      </div>
      <div className="profile-social-controls">
        {!owner && onFriend && (
          <button
            className="button secondary"
            disabled={
              friend?.status === "pending" && friend.requestedBy === viewerId
            }
            onClick={() =>
              onFriend(
                friend?.status === "accepted"
                  ? "remove"
                  : friend?.status === "pending"
                    ? "accept"
                    : "request",
              )
            }
          >
            {friend?.status === "accepted"
              ? "Remove friend"
              : friend?.status === "pending"
                ? friend.requestedBy === viewerId
                  ? "Request pending"
                  : "Accept friend request"
                : "Add friend"}
          </button>
        )}
        {owner && onCollections && (
          <button className="text-button" onClick={onCollections}>
            Your collections <ArrowUpRight size={16} />
          </button>
        )}
      </div>
      <div className="profile-journal-heading">
        <h2>The personal program</h2>
        <p>Curated, never completed.</p>
      </div>
      {showcase?.shelves.map((shelf, index) => (
        <section className="profile-shelf" key={shelf.id}>
          <div className="shelf-heading">
            <div>
              <h3>{shelf.title}</h3>
              <span>{shelf.itemIds.length} stories</span>
            </div>
            {owner && (
              <button
                className="icon-button"
                onClick={onEdit}
                aria-label={`Edit ${shelf.title}`}
              >
                <PencilSimple size={18} />
              </button>
            )}
          </div>
          {shelf.layout === "spread" ? (
            <div className="collection-spread">
              {shelf.itemIds.slice(0, 2).map((id) => {
                const t = catalog.find((t) => t.id === id);
                return (
                  t && (
                    <button onClick={() => onTitle(t)} key={id}>
                      <Artwork title={t} backdrop />
                      <span>
                        <small>
                          {t.media === "game"
                            ? "A WORLD TO GET LOST IN"
                            : "A STORY TO RETURN TO"}
                        </small>
                        <strong>{t.title}</strong>
                        <ArrowUpRight size={20} />
                      </span>
                    </button>
                  )
                );
              })}
            </div>
          ) : (
            <div className="showcase-covers">
              {shelf.itemIds.map((id) => {
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
          )}
          {index === 0 && (
            <div className="shelf-annotation">
              Some favorites don’t need an explanation.
            </div>
          )}
        </section>
      ))}
      {!showcase?.shelves.length && (
        <div className="empty-state">
          <h2>Your taste deserves a stage.</h2>
          <p>
            Choose a featured work, build a shelf, and make this space your own.
          </p>
          {owner && (
            <button className="button" onClick={onEdit}>
              <Plus size={17} /> Create a shelf
            </button>
          )}
        </div>
      )}
    </div>
  );
}
