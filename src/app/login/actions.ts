"use server";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";

export async function signIn(_prev: { error?: string } | undefined, fd: FormData) {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Informe e-mail e senha." };
  const sb = await serverClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "E-mail ou senha inválidos." };
  redirect("/");
}
