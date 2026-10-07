import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(__dirname, "..", "..");

/** Postgres embutido com o stub do Supabase + todas as migrations. */
export async function freshDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(root, "tests", "helpers", "supabase-stub.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/create extension if not exists pgcrypto;/g, "");
    await db.exec(sql);
  }
  const su = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  /** Executa como usuário autenticado (RLS ativa). */
  const as = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      await tx.exec("set local role authenticated");
      return (await tx.query<T>(sql, params)).rows;
    });
  return { db, su, as };
}
