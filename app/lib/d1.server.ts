import type { SqlDb, SqlStatement, SqlValue } from "@/db/sql";

/**
 * Cloudflare D1 implementation of SqlDb. The repositories never import this
 * file — the Worker request handler passes the wrapped binding in.
 */

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results?: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  exec(query: string): Promise<unknown>;
}

function wrap(stmt: D1PreparedStatementLike): SqlStatement {
  return {
    bind(...values: SqlValue[]): SqlStatement {
      return wrap(stmt.bind(...values));
    },
    async all<T>(): Promise<T[]> {
      const result = await stmt.all<T>();
      return result.results ?? [];
    },
    async first<T>(): Promise<T | null> {
      return (await stmt.first<T>()) ?? null;
    },
    async run(): Promise<void> {
      await stmt.run();
    },
  };
}

export function d1Db(binding: D1DatabaseLike): SqlDb {
  return {
    async exec(sql: string): Promise<void> {
      // D1's exec runs statements split on newlines; collapse each statement to one line.
      for (const statement of sql.split(";")) {
        const trimmed = statement.trim();
        if (trimmed) await binding.exec(trimmed.replace(/\s+/g, " ") + ";");
      }
    },
    prepare(sql: string): SqlStatement {
      return wrap(binding.prepare(sql));
    },
  };
}
