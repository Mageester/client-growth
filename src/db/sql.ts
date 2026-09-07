/**
 * The narrow database surface the repositories depend on. Satisfied in
 * production by a thin wrapper over Cloudflare D1 (app/lib/d1.server.ts) and in
 * tests / local seeding by a wrapper over node:sqlite (src/db/nodeSqlite.ts).
 *
 * Deliberately tiny: prepared statements with positional `?` params, plus a
 * multi-statement `exec` for applying the schema.
 */

export type SqlValue = string | number | null;

export interface RunResult {
  /** Rows inserted/updated/deleted by this statement. */
  rowsAffected: number;
}

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<T[]>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<RunResult>;
}

/**
 * One statement in an atomic batch: plain SQL with optional positional params.
 * Params are bound in order, exactly like `SqlStatement.bind`.
 */
export interface SqlBatchStatement {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDb {
  exec(sql: string): Promise<void>;
  prepare(sql: string): SqlStatement;
  /**
   * Run `statements` as ONE atomic unit. If any statement fails, the whole
   * batch is aborted and nothing is committed. Production D1 provides this
   * through its documented transactional `batch()`; the node:sqlite adapter
   * wraps the statements in BEGIN/COMMIT with ROLLBACK on failure.
   */
  batch(statements: readonly SqlBatchStatement[]): Promise<RunResult[]>;
}
