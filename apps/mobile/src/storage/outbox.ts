import type { ProgressCommand, LibraryEditCommand } from "@ludex/domain";
export type SqlValue = string | number | null;
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  transaction(task: (tx: SqlDriver) => Promise<void>): Promise<void>;
}
export type Pending = {
  commandId: string;
  kind: "progress" | "library";
  payload: ProgressCommand | LibraryEditCommand;
  status: "pending" | "conflict" | "rejected";
  error?: string;
};
export class OwnerStore {
  constructor(
    readonly db: SqlDriver,
    readonly owner: string,
  ) {}
  async init() {
    await this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS outbox (owner TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, created INTEGER NOT NULL, PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS drafts (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS cache (owner TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(owner,id)); PRAGMA user_version=1;`,
    );
  }
  async enqueue(kind: Pending["kind"], payload: Pending["payload"]) {
    await this.db.transaction(async (tx) => {
      const existing = await tx.all<{ payload: string }>(
        "SELECT payload FROM outbox WHERE owner=? AND id=?",
        [this.owner, payload.commandId],
      );
      if (existing.length) {
        if (existing[0].payload !== JSON.stringify(payload))
          throw new Error("command-payload-changed");
        return;
      }
      await tx.run(
        "INSERT OR REPLACE INTO drafts(owner,id,body) VALUES(?,?,?)",
        [this.owner, "submitted:" + payload.commandId, JSON.stringify(payload)],
      );
      await tx.run(
        "INSERT INTO outbox(owner,id,kind,payload,created) VALUES(?,?,?,?,?)",
        [
          this.owner,
          payload.commandId,
          kind,
          JSON.stringify(payload),
          Date.now(),
        ],
      );
      await tx.run(
        "INSERT OR REPLACE INTO cache(owner,id,body,expires) VALUES(?,?,?,?)",
        [
          this.owner,
          "pending:" + payload.titleId,
          JSON.stringify(payload),
          Date.now() + 30 * 86400000,
        ],
      );
    });
  }
  async pending(): Promise<Pending[]> {
    const rows = await this.db.all<{
      id: string;
      kind: Pending["kind"];
      payload: string;
      status: Pending["status"];
      error?: string;
    }>("SELECT * FROM outbox WHERE owner=? ORDER BY created,id", [this.owner]);
    return rows.map((row) => ({
      commandId: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload),
      status: row.status,
      error: row.error,
    }));
  }
  async acknowledge(id: string) {
    await this.db.transaction(async (tx) => {
      const rows = await tx.all<{ payload: string }>(
        "SELECT payload FROM outbox WHERE owner=? AND id=?",
        [this.owner, id],
      );
      await tx.run("DELETE FROM outbox WHERE owner=? AND id=?", [
        this.owner,
        id,
      ]);
      if (rows[0]) {
        const p = JSON.parse(rows[0].payload);
        await tx.run("DELETE FROM cache WHERE owner=? AND id=?", [
          this.owner,
          "pending:" + p.titleId,
        ]);
      }
    });
  }
  async mark(id: string, status: Pending["status"], error: string) {
    await this.db.run(
      "UPDATE outbox SET status=?,error=? WHERE owner=? AND id=?",
      [status, error, this.owner, id],
    );
  }
  async discard(id: string) {
    await this.acknowledge(id);
  }
  async saveDraft(id: string, body: unknown) {
    await this.db.run(
      "INSERT OR REPLACE INTO drafts(owner,id,body) VALUES(?,?,?)",
      [this.owner, id, JSON.stringify(body)],
    );
  }
  async draft<T>(id: string): Promise<T | null> {
    const rows = await this.db.all<{ body: string }>(
      "SELECT body FROM drafts WHERE owner=? AND id=?",
      [this.owner, id],
    );
    return rows[0] ? JSON.parse(rows[0].body) : null;
  }
  async removeDraft(id: string) {
    await this.db.run("DELETE FROM drafts WHERE owner=? AND id=?", [
      this.owner,
      id,
    ]);
  }
  async cache(id: string, body: unknown, ttl = 86400000) {
    await this.db.run(
      "INSERT OR REPLACE INTO cache(owner,id,body,expires) VALUES(?,?,?,?)",
      [this.owner, id, JSON.stringify(body), Date.now() + ttl],
    );
  }
  async cached<T>(id: string): Promise<T | null> {
    const rows = await this.db.all<{ body: string }>(
      "SELECT body FROM cache WHERE owner=? AND id=? AND expires>?",
      [this.owner, id, Date.now()],
    );
    return rows[0] ? JSON.parse(rows[0].body) : null;
  }
  async purge() {
    await this.db.transaction(async (tx) => {
      for (const table of ["outbox", "drafts", "cache"])
        await tx.run(`DELETE FROM ${table} WHERE owner=?`, [this.owner]);
    });
  }
}
