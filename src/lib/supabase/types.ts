import type { SupabaseClient } from "@supabase/supabase-js";

/** Cliente tipado para o schema "utmfy" (não é "public" — ver supabase/migrations). */
export type Db = SupabaseClient<any, "utmfy", any>;
