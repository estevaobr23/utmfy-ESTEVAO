import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold">UTMFY Tracker</h1>
        <p className="mb-4 text-sm text-slate-500">Acesso restrito. Contas são criadas pelo script <code>npm run admin:create</code>.</p>
        <LoginForm />
      </div>
    </main>
  );
}
