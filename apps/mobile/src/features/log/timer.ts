export function timerMinutes(started: number | null, now = Date.now()) {
  if (started === null || now < started) return undefined;
  return Math.max(1, Math.round((now - started) / 60000));
}
