export function resolveIncomingUrl(
  value: string,
  allowedOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? "https://ludex.example",
): {
  kind: "title" | "profile" | "activity" | "collection" | "plan";
  id: string;
} | null {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(allowedOrigin).origin) return null;
    const match = url.pathname.match(
      /^\/(title|profile|activity|collection|plan)\/?$/,
    );
    if (!match) return null;
    const kind = match[1] as
      "title" | "profile" | "activity" | "collection" | "plan";
    const key = kind === "profile" ? "u" : "id";
    const ids = url.searchParams.getAll(key);
    if (
      ids.length !== 1 ||
      !ids[0] ||
      ids[0].length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(ids[0])
    )
      return null;
    return { kind, id: ids[0] };
  } catch {
    return null;
  }
}
