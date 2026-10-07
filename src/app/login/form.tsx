"use client";
import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input name="email" type="email" autoComplete="email" placeholder="E-mail" required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="password" type="password" autoComplete="current-password" placeholder="Senha" required className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      {state?.error && <p className="text-sm text-rose-700">{state.error}</p>}
      <button disabled={pending} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
