export function base64url(value: string) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function readGoogleHandoff(value: string, state: string) {
  const url = new URL(value);
  if (
    url.protocol !== "ludex:" ||
    url.hostname !== "auth" ||
    url.pathname !== "" ||
    !state ||
    url.searchParams.get("state") !== state ||
    !url.searchParams.get("code")
  ) {
    throw new Error("Google sign-in returned an invalid handoff. Try again.");
  }
  return url.searchParams.get("code")!;
}
