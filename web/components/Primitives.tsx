"use client";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowUpRight } from "@phosphor-icons/react";
import type { CatalogHit } from "@ludex/domain";
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal ${wide ? "modal-wide" : ""}`}>
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="modal-description">
            {description ?? "Manage your Ludex journal."}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Artwork({
  title,
  backdrop = false,
  className = "",
}: {
  title?: CatalogHit;
  backdrop?: boolean;
  className?: string;
}) {
  if (!title) return <div className={`artwork ${className}`} />;
  return (
    <div
      className={`artwork ${className}`}
      style={{ backgroundColor: "#272334" }}
    >
      {(
        backdrop
          ? (title.backdrop ?? title.artwork ?? "/art/lounge.webp")
          : title.artwork
      ) ? (
        <Image
          fill
          unoptimized
          sizes="(max-width:760px) 90vw, 640px"
          src={
            (backdrop
              ? (title.backdrop ?? title.artwork ?? "/art/lounge.webp")
              : title.artwork)!
          }
          alt={backdrop ? "" : `${title.title} artwork`}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : null}
      <span className="art-fallback">{title.title}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <ArrowUpRight size={24} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {name
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
