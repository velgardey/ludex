import { CosmosClient } from "@azure/cosmos";
import type { OperationInput } from "@azure/cosmos";
import type { Operation, Repository, Stored } from "./repository.ts";
/** Partition-only adapter. Must pass disposable-cloud ETag/rollback tests before deployment. */
export class CosmosRepository implements Repository {
  private container;
  constructor(connectionString: string, database: string, container: string) {
    this.container = new CosmosClient(connectionString)
      .database(database)
      .container(container);
  }
  async read(scope: string, id: string): Promise<Stored | null> {
    try {
      const { resource } = await this.container
        .item(id, scope)
        .read<Stored & { _etag: string }>();
      return resource
        ? {
            id: resource.id,
            scope: resource.scope,
            version: resource.version,
            body: resource.body,
            etag: resource._etag,
          }
        : null;
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }
  async list(scope: string, prefix = ""): Promise<Stored[]> {
    const { resources } = await this.container.items
      .query<Stored & { _etag: string }>(
        {
          query:
            "SELECT * FROM c WHERE c.scope=@scope AND STARTSWITH(c.id,@prefix)",
          parameters: [
            { name: "@scope", value: scope },
            { name: "@prefix", value: prefix },
          ],
        },
        { partitionKey: scope, maxItemCount: 100 },
      )
      .fetchAll();
    return resources.map((r) => ({ ...r, etag: r._etag }));
  }
  async transact(
    scope: string,
    operations: Operation[],
  ): Promise<"committed" | "conflict"> {
    if (
      operations.some((op) => op.kind !== "delete" && op.value.scope !== scope)
    )
      throw new Error("scope-mismatch");
    const batch: OperationInput[] = operations.map((op) =>
      op.kind === "create"
        ? {
            operationType: "Create" as const,
            resourceBody: JSON.parse(JSON.stringify(op.value)),
          }
        : op.kind === "replace"
          ? {
              operationType: "Replace" as const,
              id: op.value.id,
              resourceBody: JSON.parse(JSON.stringify(op.value)),
              ifMatch: op.expectedEtag,
            }
          : {
              operationType: "Delete" as const,
              id: op.id,
              ifMatch: op.expectedEtag,
            },
    );
    const result = await this.container.items.batch(batch, scope);
    if (
      result.code === 409 ||
      result.code === 412 ||
      result.result?.some((r) => r.statusCode === 409 || r.statusCode === 412)
    )
      return "conflict";
    if ((result.code ?? 500) >= 300)
      throw new Error(`cosmos-transaction-${result.code}`);
    return "committed";
  }
}
