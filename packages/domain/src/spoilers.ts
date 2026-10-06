export const canReveal = (
  viewedIds: Set<string>,
  requiredIds: string[],
): boolean => requiredIds.every((id) => viewedIds.has(id));
