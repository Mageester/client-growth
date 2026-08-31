/**
 * The narrow database surface the repositories depend on. Satisfied in
 * production by a thin wrapper over Cloudflare D1 (app/lib/d1.server.ts) and in
 * tests / local seeding by a wrapper over node:sqlite (src/db/nodeSqlite.ts).
 *
 * Deliberately tiny: prepared statements with positional `?` params, plus a
 * multi-statement `exec` for applying the schema.
 */

export type SqlValue = string | number | null;

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<T[]>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<void>;
}

export interface SqlDb {
  exec(sql: string): Promise<void>;
  prepare(sql: string): SqlStatement;
}
