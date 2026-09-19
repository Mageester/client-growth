// app/lib/d1.server.ts
function wrap(stmt) {
  return {
    bind(...values) {
      return wrap(stmt.bind(...values));
    },
    async all() {
      const result = await stmt.all();
      return result.results ?? [];
    },
    async first() {
      return await stmt.first() ?? null;
    },
    async run() {
      const r = await stmt.run();
      return {
        rowsAffected: r.meta?.changes ?? r.meta?.rows_written ?? 0,
        ...r.meta?.last_row_id === void 0 ? {} : { lastRowId: r.meta.last_row_id }
      };
    }
  };
}
__name(wrap, "wrap");
function d1Db(binding) {
  return {
    async exec(sql2) {
      for (const statement of sql2.split(";")) {
        const trimmed = statement.trim();
        if (trimmed) await binding.exec(trimmed.replace(/\s+/g, " ") + ";");
      }
    },
    prepare(sql2) {
      return wrap(binding.prepare(sql2));
    },
    async batch(statements) {
      const prepared = statements.map((statement) => {
        const stmt = binding.prepare(statement.sql);
        return statement.params?.length ? stmt.bind(...statement.params) : stmt;
      });
      const results = await binding.batch(prepared);
      return results.map(
        (r) => ({
          rowsAffected: r.meta?.changes ?? r.meta?.rows_written ?? 0,
          ...r.meta?.last_row_id === void 0 ? {} : { lastRowId: r.meta.last_row_id }
        })
      );
    }
  };
}
__name(d1Db, "d1Db");
