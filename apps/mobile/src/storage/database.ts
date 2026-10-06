import * as SQLite from "expo-sqlite";
import { OwnerStore, type SqlDriver, type SqlValue } from "./outbox";
function driverFor(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: async (sql) => {
      await db.execAsync(sql);
    },
    run: async (sql, params = []) => {
      await db.runAsync(sql, params);
    },
    all: async <T>(sql: string, params: SqlValue[] = []) =>
      db.getAllAsync<T>(sql, params),
    transaction: async (task) => {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await task(driverFor(tx));
      });
    },
  };
}
export async function openOwnerStore(owner: string) {
  const db = await SQLite.openDatabaseAsync(
    `ludex-${owner.replace(/[^a-zA-Z0-9_-]/g, "_")}.db`,
  );
  const store = new OwnerStore(driverFor(db), owner);
  await store.init();
  return { store, close: () => db.closeAsync() };
}
