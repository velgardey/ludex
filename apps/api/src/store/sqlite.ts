import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Operation, Repository, Stored } from "./repository.ts";
export class SqliteRepository implements Repository {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents(scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,etag TEXT NOT NULL,PRIMARY KEY(scope,id));",
    );
  }
  async read(scope: string, id: string): Promise<Stored | null> {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE scope=? AND id=?")
      .get(scope, id);
    return row ? this.decode(row) : null;
  }
  async list(scope: string, prefix = ""): Promise<Stored[]> {
    return this.db
      .prepare(
        "SELECT * FROM documents WHERE scope=? AND substr(id,1,?)=? ORDER BY id",
      )
      .all(scope, prefix.length, prefix)
      .map((row) => this.decode(row));
  }
  private decode(row: Record<string, unknown>): Stored {
    return {
      scope: String(row.scope),
      id: String(row.id),
      version: Number(row.version),
      body: JSON.parse(String(row.body)),
      etag: String(row.etag),
    };
  }
  async transact(
    scope: string,
    operations: Operation[],
  ): Promise<"committed" | "conflict"> {
    if (
      operations.some((op) => op.kind !== "delete" && op.value.scope !== scope)
    )
      throw new Error("scope-mismatch");
    if (operations.length > 100) throw new Error("transaction-limit");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const op of operations) {
        const id = op.kind === "delete" ? op.id : op.value.id;
        const row = this.db
          .prepare("SELECT etag FROM documents WHERE scope=? AND id=?")
          .get(scope, id);
        if (
          (op.kind === "create" && row) ||
          (op.kind !== "create" && (!row || row.etag !== op.expectedEtag))
        ) {
          this.db.exec("ROLLBACK");
          return "conflict";
        }
        if (op.kind === "delete")
          this.db
            .prepare("DELETE FROM documents WHERE scope=? AND id=?")
            .run(scope, id);
        else if (op.kind === "create")
          this.db
            .prepare(
              "INSERT INTO documents(scope,id,version,body,etag) VALUES(?,?,?,?,?)",
            )
            .run(
              scope,
              id,
              op.value.version,
              JSON.stringify(op.value.body),
              randomUUID(),
            );
        else
          this.db
            .prepare(
              "UPDATE documents SET version=?,body=?,etag=? WHERE scope=? AND id=?",
            )
            .run(
              op.value.version,
              JSON.stringify(op.value.body),
              randomUUID(),
              scope,
              id,
            );
      }
      this.db.exec("COMMIT");
      return "committed";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
