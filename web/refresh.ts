export async function readJournalPanels<
  T extends Record<string, () => Promise<unknown>>,
>(
  sources: T,
): Promise<
  Partial<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> & {
    failures: string[];
  }
> {
  const entries = Object.entries(sources);
  const results = await Promise.allSettled(entries.map(([, read]) => read()));
  const out: Record<string, unknown> = { failures: [] };
  results.forEach((result, index) => {
    const key = entries[index][0];
    if (result.status === "fulfilled") out[key] = result.value;
    else (out.failures as string[]).push(key);
  });
  return out as Partial<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> & {
    failures: string[];
  };
}
