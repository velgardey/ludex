export function refreshVisibleFeed<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const visible = new Map(incoming.map((item) => [item.id, item]));
  return current.flatMap((item) => {
    const replacement = visible.get(item.id);
    return replacement ? [replacement] : [];
  });
}
