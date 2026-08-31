import { DatabaseSync } from "node:sqlite";

import type { SqlDb, SqlStatement, SqlValue } from "@/db/sql";

/**
 * node:sqlite implementation of SqlDb for tests and local seeding. Not used at
 * runtime on Cloudflare. Synchronous under the hood, wrapped in resolved
 * promises to match the async D1 shape.
 */
export interface NodeSqliteDb extends SqlDb {
  close(): void;
  raw: DatabaseSync;
}

function statement(db: DatabaseSync, sql: string, bound: SqlValue[]): SqlStatement {
  return {
    bind(...values: SqlValue[]): SqlStatement {
      return statement(db, sql, values);
    },
    all<T>(): Promise<T[]> {
      return Promise.resolve(db.prepare(sql).all(...bound) as T[]);
    },
    first<T>(): Promise<T | null> {
      const row = db.prepare(sql).get(...bound);
      return Promise.resolve((row ?? null) as T | null);
    },
    run(): Promise<void> {
      db.prepare(sql).run(...bound);
      return Promise.resolve();
    },
  };
}

export function nodeSqliteDb(location = ":memory:"): NodeSqliteDb {
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON;");
  return {
    raw: db,
    exec(sql: string): Promise<void> {
      db.exec(sql);
      return Promise.resolve();
    },
    prepare(sql: string): SqlStatement {
      return statement(db, sql, []);
    },
    close(): void {
      db.close();
    },
  };
}
