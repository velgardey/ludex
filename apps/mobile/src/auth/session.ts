import * as SecureStore from "expo-secure-store";
import type { Session } from "@ludex/domain";
const key = "ludex.session.v1";
export async function restoreSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (
      !session.token ||
      !session.user?.id ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      await clearSession();
      return null;
    }
    return session;
  } catch {
    await clearSession();
    return null;
  }
}
export async function persistSession(session: Session) {
  await SecureStore.setItemAsync(key, JSON.stringify(session));
}
export async function clearSession() {
  await SecureStore.deleteItemAsync(key);
}
