import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SqliteRepository } from "./store/sqlite.ts";
import { createApplication } from "./http.ts";
export async function startServer(
  options: { port?: number; dbPath?: string; host?: string } = {},
) {
  const port = options.port ?? Number(process.env.PORT ?? 4000);
  const repo = new SqliteRepository(
    options.dbPath ??
      process.env.LUDEX_DB_PATH ??
      resolve(".local/ludex.sqlite"),
  );
  const authMode = process.env.LUDEX_AUTH_MODE ?? "local";
  if (authMode !== "local" && authMode !== "oidc")
    throw Error("LUDEX_AUTH_MODE must be local or oidc");
  if (process.env.NODE_ENV === "production" && authMode === "local")
    throw Error(
      "Production requires OIDC auth; local password login is disabled.",
    );
  const app = await createApplication(repo, {
    auth: {
      mode: authMode,
      inviteCode: process.env.LUDEX_LOCAL_INVITE ?? "LUDEX-LOCAL-BETA",
      issuer: process.env.OIDC_ISSUER,
      audience: process.env.OIDC_AUDIENCE,
      jwksUrl: process.env.OIDC_JWKS_URL,
      moderatorEmails: (process.env.LUDEX_MODERATOR_EMAILS ?? "")
        .split(",")
        .filter(Boolean),
    },
    corsOrigins: (
      process.env.LUDEX_CORS_ORIGINS ??
      "http://localhost:3000,http://127.0.0.1:3000"
    ).split(","),
  });
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 65536) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              code: "request-too-large",
              message: "Request exceeds 64 KiB.",
            }),
          );
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      headers.set("x-forwarded-for", req.socket.remoteAddress ?? "local");
      const request = new Request(
        `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? "/"}`,
        { method: req.method, headers, ...(body.length ? { body } : {}) },
      );
      const response = await app(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ code: "internal-error", message: "Request failed." }),
      );
    }
  });
  await new Promise<void>((r) =>
    server.listen(
      port,
      options.host ?? process.env.LUDEX_HOST ?? "127.0.0.1",
      r,
    ),
  );
  return {
    server,
    repo,
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((r, j) =>
        server.close((e) => {
          repo.close();
          if (e) j(e);
          else r();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const running = await startServer();
  console.log(
    `Ludex local API listening on http://localhost:${running.port}/api (persistent SQLite; cloud not verified)`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void running.close().then(() => process.exit(0));
    });
}
