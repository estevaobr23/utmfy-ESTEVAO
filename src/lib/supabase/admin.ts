import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";
import type { Db } from "./types";

let admin: Db | null = null;

/** Cliente service_role (ignora RLS). Só em route handlers/server actions/jobs. */
export function adminClient(): Db {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL não configurados");
  }
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "utmfy" },
  });
  return admin;
}
