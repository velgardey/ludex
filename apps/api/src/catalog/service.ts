import type { CatalogHit } from "../../../../packages/domain/src/types.ts";
import type { Repository } from "../store/repository.ts";
import { stored } from "../store/repository.ts";
import { catalog } from "./seed.ts";
import { ApiError } from "../errors.ts";
export async function seedCatalog(repo: Repository) {
  for (const title of catalog) {
    const old = await repo.read("catalog", title.id);
    if (!old)
      await repo.transact("catalog", [
        { kind: "create", value: stored("catalog", title.id, title) },
      ]);
    else if ((old.body as CatalogHit).sample)
      await repo.transact("catalog", [
        {
          kind: "replace",
          value: stored("catalog", title.id, title, old.version + 1),
          expectedEtag: old.etag,
        },
      ]);
  }
}
export async function searchCatalog(
  repo: Repository,
  query: { text?: string; media?: string; region?: string },
): Promise<CatalogHit[]> {
  if ((query.text?.length ?? 0) > 200)
    throw new ApiError(400, "search-too-long");
  return (await repo.list("catalog"))
    .map((row) => row.body as CatalogHit)
    .filter(
      (t) =>
        (!query.media || t.media === query.media) &&
        (!query.text ||
          t.title.toLowerCase().includes(query.text.toLowerCase())),
    )
    .slice(0, 50);
}
