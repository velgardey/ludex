import type { CommandResult } from "@ludex/domain";
import type { OwnerStore, Pending } from "../storage/outbox";
export async function drain(
  store: OwnerStore,
  send: (entry: Pending) => Promise<CommandResult>,
) {
  let accepted = 0,
    failed = 0;
  const acceptedResults: CommandResult[] = [];
  for (const entry of await store.pending()) {
    if (entry.status !== "pending") continue;
    try {
      const result = await send(entry);
      if (result.status === "accepted") {
        await store.acknowledge(entry.commandId);
        accepted++;
        acceptedResults.push(result);
      } else {
        await store.mark(
          entry.commandId,
          result.status,
          result.status === "conflict"
            ? `Changed on another device (version ${result.currentVersion}). Review your draft.`
            : result.code,
        );
        failed++;
      }
    } catch (error) {
      failed++;
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
      const state =
        status === 409
          ? "conflict"
          : status === 400 || status === 403 || status === 422
            ? "rejected"
            : "pending";
      await store.mark(
        entry.commandId,
        state,
        error instanceof Error ? error.message : "Waiting for connection",
      );
      break;
    }
  }
  return { accepted, failed, acceptedResults };
}
