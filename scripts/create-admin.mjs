// Cria (ou reaproveita) o usuário administrador + workspace principal.
// Uso: npm run admin:create -- --email voce@exemplo.com [--password "..."] [--workspace principal]
// Sem --password, gera uma senha e grava em ./admin-credentials.local.txt (gitignored) — nada é impresso.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { arg, loadEnv } from "./_env.mjs";

const env = loadEnv();
const email = arg("email");
const slug = arg("workspace", "principal");
if (!email) {
  console.error("Informe --email");
  process.exit(1);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let password = arg("password");
const generated = !password;
if (generated) password = randomBytes(18).toString("base64url");

let userId;
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (existing) {
  userId = existing.id;
  if (!generated) await db.auth.admin.updateUserById(userId, { password });
  console.log(`Usuário já existia: ${email}${generated ? " (senha mantida)" : " (senha atualizada)"}`);
} else {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    console.error("Falha ao criar usuário:", error.message);
    process.exit(1);
  }
  userId = data.user.id;
  console.log(`Usuário criado: ${email}`);
  if (generated) {
    writeFileSync("admin-credentials.local.txt", `email=${email}\npassword=${password}\n`, { mode: 0o600 });
    console.log("Senha gerada salva em admin-credentials.local.txt (apague depois de guardar num gerenciador de senhas).");
  }
}

let { data: ws } = await db.from("workspaces").select("id, is_demo").eq("slug", slug).maybeSingle();
if (!ws) {
  ({ data: ws } = await db.from("workspaces").insert({ name: "Principal", slug }).select("id, is_demo").single());
  console.log(`Workspace criado: ${slug}`);
}
await db.from("workspace_members").upsert({ workspace_id: ws.id, user_id: userId, role: "owner" });
await db.from("cakto_connections").upsert({ workspace_id: ws.id }, { onConflict: "workspace_id", ignoreDuplicates: true });
console.log(`OK — ${email} é owner do workspace "${slug}". Webhook: /api/webhooks/cakto?ws=${slug}`);
