export function offerRefresh<
  T extends { items: { id: string }[]; etag: string },
>(displayed: T, incoming: T) {
  const latest = new Map(incoming.items.map((item) => [item.id, item]));
  return {
    displayed: {
      ...displayed,
      items: displayed.items.flatMap((item) => {
        const current = latest.get(item.id);
        return current ? [current] : [];
      }),
    } as T,
    offered: incoming.etag !== displayed.etag ? incoming : null,
  };
}
export function publicShelves<T extends { audience: { kind: string } }>(
  shelves: T[],
) {
  return shelves.filter((s) => s.audience.kind === "public");
}
export function moveShelf<T>(items: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
