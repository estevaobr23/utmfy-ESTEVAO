import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/** Cliente com a sessão do usuário (RLS ativa). */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: "utmfy" },
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Chamado de Server Component: o proxy renova a sessão.
        }
      },
    },
  });
}
