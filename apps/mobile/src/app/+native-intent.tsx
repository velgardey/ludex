import { resolveIncomingUrl } from "../links/resolve";
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  if (path.startsWith("ludex://")) {
    try {
      const parsed = new URL(path);
      const kind = parsed.hostname;
      const id = parsed.searchParams.get(kind === "profile" ? "u" : "id");
      if (["title", "profile", "activity", "collection"].includes(kind) && id)
        return `/${kind}?id=${encodeURIComponent(id)}`;
    } catch {
      return "/";
    }
  }
  const route = resolveIncomingUrl(path);
  if (route && route.kind !== "plan")
    return `/${route.kind}?id=${encodeURIComponent(route.id)}`;
  return "/";
}
