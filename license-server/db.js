/**
 * Kết nối database.
 * - Có TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN): dùng Turso (libSQL trên mây) → dữ liệu không mất khi
 *   Render deploy / khởi động lại (ổ đĩa Render bản free bị xóa mỗi lần như vậy).
 * - Không có: file SQLite cục bộ (DB_PATH hoặc licenses.db) để chạy trên máy.
 *
 * Giữ kiểu gọi giống node:sqlite: db.prepare(sql).get/all/run(...args), db.exec(sql) — nhưng trả về Promise.
 */
const path = require('path');
const { createClient } = require('@libsql/client');

function openDb() {
  const remote = Boolean(process.env.TURSO_DATABASE_URL);
  const url = remote
    ? process.env.TURSO_DATABASE_URL
    : `file:${process.env.DB_PATH || path.join(__dirname, 'licenses.db')}`;
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

  const execute = (sql, args) => client.execute({ sql, args: args.map((v) => (v === undefined ? null : v)) });
  const rows = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

  return {
    remote,
    url: remote ? url.replace(/\/\/[^@]*@/, '//') : url,
    prepare(sql) {
      return {
        get: async (...args) => rows(await execute(sql, args))[0],
        all: async (...args) => rows(await execute(sql, args)),
        run: async (...args) => {
          const rs = await execute(sql, args);
          return {
            changes: rs.rowsAffected,
            lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
          };
        },
      };
    },
    exec: (sql) => client.executeMultiple(sql),
  };
}

module.exports = { openDb };
