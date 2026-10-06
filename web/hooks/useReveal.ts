"use client";
import { useEffect, useRef } from "react";
import { waapi } from "animejs/waapi";
import { useMotionPreference } from "./useMotionPreference";

/** Observes each story once. No scroll listeners or frame-driven React state. */
export function useReveal(key: string) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useMotionPreference();
  useEffect(() => {
    if (reduced || !root.current) return;
    const animations: ReturnType<typeof waapi.animate>[] = [];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
        observer.unobserve(entry.target);
        animations.push(waapi.animate(entry.target, { opacity: [0.65, 1], translateY: [16, 0], duration: 450, ease: "out(4)" }));
      }
    }, { threshold: 0.12 });
    root.current.querySelectorAll(".activity").forEach(item => observer.observe(item));
    return () => { observer.disconnect(); animations.forEach(animation => animation.revert()); };
  }, [reduced, key]);
  return root;
}
