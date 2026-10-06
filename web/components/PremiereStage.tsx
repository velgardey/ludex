"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import Image from "next/image";
import { waapi } from "animejs/waapi";
import { ArrowUpRight, FilmSlate, GameController, Television } from "@phosphor-icons/react";
import type { CatalogHit } from "@ludex/client";
import { motion } from "motion/react";
import { useMotionPreference } from "../hooks/useMotionPreference";
import { Artwork } from "./Primitives";

/** Bounded entrance; content and controls are visible before hydration. */
export function PremiereStage({ mode, catalog, onTitle, onAction, artEnabled }: {
  mode: "feed" | "discover";
  artEnabled: boolean;
  catalog: CatalogHit[];
  onTitle: (title: CatalogHit) => void;
  onAction: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const reduced = useMotionPreference();
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations: ReturnType<typeof waapi.animate>[] = [];
    const cancel = () => { animations.forEach(animation => animation.revert()); animations = []; };
    const enter = () => {
      cancel();
      if (media.matches || document.documentElement.classList.contains("reduce-motion") || !root.current) return;
      const copy = root.current.querySelector<HTMLElement>(".premiere-copy");
      const artwork = root.current.querySelector<HTMLImageElement>(".premiere-art");
      const posters = root.current.querySelectorAll<HTMLElement>(".premiere-poster");
      if (copy) animations.push(waapi.animate(copy, { opacity: [0, 1], translateY: [20, 0], duration: 650, ease: "out(4)" }));
      if (artwork) animations.push(waapi.animate(artwork, { opacity: [0.5, 1], scale: [1.035, 1], duration: 1100, ease: "out(4)" }));
      posters.forEach((poster, index) => animations.push(waapi.animate(poster, { opacity: [0, 1], duration: 650, delay: 90 + index * 65, ease: "out(4)" })));
    };
    enter();
    media.addEventListener("change", enter);
    const observer = new MutationObserver(() => {
      if (document.documentElement.classList.contains("reduce-motion")) cancel();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { cancel(); media.removeEventListener("change", enter); observer.disconnect(); };
  }, [mode, artEnabled]);
  const titles = catalog.slice(0, 3);
  return <section ref={root} className={`premiere-stage premiere-${mode}`} aria-label={mode === "feed" ? "Your social journal" : "Discover stories"}>
    {artEnabled && <Image className="premiere-art" src="/art/premiere.webp" alt="" fill unoptimized sizes="(max-width:760px) 100vw, 850px" priority />}
    <div className="premiere-shade" />
    <div className="premiere-copy">
      <span className="premiere-eyebrow"><span /> THE LUDEX EXPERIENCE</span>
      <h1>{mode === "feed" ? <>A life<br />in stories<span>.</span></> : <>Follow your<br />curiosity<span>.</span></>}</h1>
      <p>{mode === "feed" ? "What we watch. What we play. What stays with us." : "A familiar feeling. An unfamiliar world."}</p>
      <button className="premiere-action" onClick={onAction}>{mode === "feed" ? "Log your next moment" : "Find your next obsession"}<ArrowUpRight size={19} /></button>
    </div>
    <div className="premiere-posters" aria-label="Explore the catalog">
      {titles.map((title, index) => <button className="premiere-poster" key={title.id} aria-label={title.title} onClick={() => onTitle(title)} style={{ "--poster-angle": `${(index - 1) * 11}deg`, "--poster-rise": `${index === 1 ? -15 : 0}px` } as CSSProperties}>
        <motion.span className="premiere-poster-inner" whileHover={reduced ? undefined : { y: -10, scale: 1.08 }} whileTap={reduced ? undefined : { scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 27 }}><Artwork title={title} /><span className="premiere-poster-arrow"><ArrowUpRight size={17} /></span></motion.span>
      </button>)}
    </div>
    <div className="premiere-bottom"><span><FilmSlate size={14} /> FILMS</span><i /><span><Television size={14} /> SERIES</span><i /><span><GameController size={14} /> GAMES</span><span className="premiere-edition">YOUR TASTE. CENTER STAGE.</span></div>
  </section>;
}
