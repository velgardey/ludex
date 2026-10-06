"use client";
import { useState } from "react";
import {
  Plus,
  Star,
  Rows,
  GridFour,
  FadersHorizontal,
  ArrowUpRight,
} from "@phosphor-icons/react";
import type { CatalogHit, LibraryItem } from "@ludex/client";
import { Artwork, Empty } from "./Primitives";
export function Library({
  catalog,
  items,
  onTitle,
  onLog,
  onEdit,
  isPreview,
}: {
  catalog: CatalogHit[];
  items: LibraryItem[];
  onTitle: (t: CatalogHit) => void;
  onLog: (t: CatalogHit) => void;
  onEdit: (t: CatalogHit, patch: Record<string, unknown>) => void;
  isPreview: boolean;
}) {
  const [filter, setFilter] = useState("All"),
    [density, setDensity] = useState("grid");
  const actual = isPreview
    ? catalog.slice(0, 8)
    : catalog.filter((t) =>
        items.some((i) => i.titleId === t.id && !i.archived),
      );
  const visible = actual.filter(
    (t) =>
      filter === "All" ||
      t.media ===
        (filter === "Films" ? "movie" : filter === "Series" ? "show" : "game"),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Your library<span>.</span>
          </h1>
          <p>Every story has a place.</p>
        </div>
        <button className="button" onClick={() => onLog(catalog[0])}>
          <Plus size={17} /> Log something
        </button>
      </div>
      <div className="content-toolbar">
        <div className="segmented">
          {["All", "Films", "Series", "Games"].map((f) => (
            <button
              key={f}
              className={filter === f ? "selected" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="density">
          <button
            className="icon-button"
            aria-label="Grid view"
            onClick={() => setDensity("grid")}
          >
            <GridFour size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="List view"
            onClick={() => setDensity("list")}
          >
            <Rows size={19} />
          </button>
        </div>
      </div>
      {!visible.length ? (
        <Empty
          title="Make room for a story."
          description="Save a film, start a series, or log a game. Your library grows with you."
          action={
            <button className="button" onClick={() => onLog(catalog[0])}>
              Add your first title <ArrowUpRight size={16} />
            </button>
          }
        />
      ) : (
        <div className={`library-works ${density}`}>
          {visible.map((t) => {
            const i = items.find((i) => i.titleId === t.id);
            return (
              <article key={t.id} className="library-work">
                <button className="library-cover" onClick={() => onTitle(t)}>
                  <Artwork title={t} />
                  <span className="cover-open">
                    <ArrowUpRight size={22} />
                  </span>
                </button>
                <div className="library-caption">
                  <button onClick={() => onTitle(t)}>{t.title}</button>
                  <p>
                    {t.year} ·{" "}
                    {t.media === "game"
                      ? "Game"
                      : t.media === "show"
                        ? "Series"
                        : "Film"}
                    {i?.rating && (
                      <span>
                        <Star weight="fill" size={12} />
                        {i.rating}
                      </span>
                    )}
                  </p>
                  <div className="library-item-actions">
                    <button className="tiny-button" onClick={() => onLog(t)}>
                      Log progress
                    </button>
                    <button
                      className="tiny-button"
                      onClick={() => onEdit(t, { owned: !i?.owned })}
                    >
                      {i?.owned ? "Owned" : "Mark owned"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="library-footer">
        <FadersHorizontal size={16} />
        <span>{visible.length} titles · Your taste, on your terms</span>
      </div>
    </>
  );
}
