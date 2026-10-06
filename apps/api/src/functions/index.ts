import { app } from "@azure/functions";
import { CosmosRepository } from "../store/cosmos.ts";
import { createApplication } from "../http.ts";
import { LudexService } from "../service.ts";
let application: ReturnType<typeof createApplication> | undefined;
let repository: CosmosRepository | undefined;
function runtime() {
  if (
    !process.env.COSMOS_CONNECTION_STRING ||
    !process.env.COSMOS_DATABASE ||
    !process.env.COSMOS_CONTAINER ||
    !process.env.OIDC_ISSUER ||
    !process.env.OIDC_AUDIENCE ||
    !process.env.OIDC_JWKS_URL
  )
    throw Error("Production storage and OIDC must be configured.");
  if (!repository)
    repository = new CosmosRepository(
      process.env.COSMOS_CONNECTION_STRING,
      process.env.COSMOS_DATABASE,
      process.env.COSMOS_CONTAINER,
    );
  if (!application)
    application = createApplication(repository, {
      auth: {
        mode: "oidc",
        issuer: process.env.OIDC_ISSUER,
        audience: process.env.OIDC_AUDIENCE,
        jwksUrl: process.env.OIDC_JWKS_URL,
      },
      corsOrigins: (process.env.LUDEX_CORS_ORIGINS ?? "")
        .split(",")
        .filter(Boolean),
    });
  return application;
}
app.http("ludex-api", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (req) => {
    try {
      const handler = await runtime();
      const body = req.method === "POST" ? await req.text() : undefined;
      const response = await handler(
        new Request(req.url, {
          method: req.method,
          headers: Object.fromEntries(req.headers),
          ...(body ? { body } : {}),
        }),
      );
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      };
    } catch {
      return {
        status: 503,
        jsonBody: {
          code: "service-not-configured",
          message: "The backend is not configured for invitations.",
        },
      };
    }
  },
});
app.timer("publication", {
  schedule: "0 */1 * * * *",
  handler: async () => {
    await runtime();
    const service = new LudexService(repository!);
    await service.initialize();
    for (const account of await repository!.list("social", "account:")) {
      await service.cleanupExpiredExports(
        (account.body as { user: { id: string } }).user.id,
      );
      await service.publishPending(
        (account.body as { user: { id: string } }).user.id,
        20,
      );
    }
  },
});
app.timer("deletion", {
  schedule: "0 */5 * * * *",
  handler: async () => {
    await runtime();
    const service = new LudexService(repository!);
    await service.initialize();
    for (const job of await repository!.list("social", "deletion:"))
      if ((job.body as { status: string }).status === "queued")
        await service.processDeletion((job.body as { jobId: string }).jobId);
  },
});
