"use client";
import { useSyncExternalStore } from "react";
const query = "(prefers-reduced-motion: reduce)";
function subscribe(change: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", change);
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => { media.removeEventListener("change", change); observer.disconnect(); };
}
function snapshot() {
  return window.matchMedia(query).matches || document.documentElement.classList.contains("reduce-motion");
}
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
