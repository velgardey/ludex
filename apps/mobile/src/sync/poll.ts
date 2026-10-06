export function pollDelay(failures: number, retryAfterSeconds?: number) {
  return Math.max(
    Math.min(120000, 30000 * 2 ** Math.max(0, failures)),
    (retryAfterSeconds ?? 0) * 1000,
  );
}
