import "server-only";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Leitura do código-fonte empacotado no deploy (ver outputFileTracingIncludes
// em next.config.ts). Segredos locais (.env*, *.local.txt, supabase/.temp)
// nunca entram no bundle e também são bloqueados aqui.

// Opaco para o bundler: sem isso o Turbopack empacota o projeto inteiro na função.
const ROOT = /* turbopackIgnore: true */ process.cwd();
const DIRS = ["src", "supabase/migrations", "supabase/sql", "scripts", "tests", "public"];
const ROOT_FILES = /^([A-Z_]+\.md|package\.json|next\.config\.ts|vercel\.json|tsconfig\.json)$/;
const EXTRA_FILES = ["supabase/config.toml"];
const BLOCKED = /(^|\/)(\.env[^/]*|[^/]*\.local\.txt|\.vercel|\.git|node_modules|\.temp|\.branches|\.next)(\/|$)/;
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|sql|md|toml|css|txt|html|yml|yaml)$/;

export function normalize(p: string): string {
  const rel = path.posix.normalize(String(p ?? "").replace(/\\/g, "/")).replace(/^\/+/, "").replace(/^\.\/?/, "");
  if (rel.startsWith("..") || BLOCKED.test(rel)) throw new Error(`caminho não permitido: ${p}`);
  return rel === "." ? "" : rel;
}

function allowed(rel: string) {
  return (
    DIRS.some((d) => rel === d || rel.startsWith(`${d}/`)) ||
    (!rel.includes("/") && ROOT_FILES.test(rel)) ||
    EXTRA_FILES.includes(rel)
  );
}

async function walk(rel: string, out: string[]) {
  const abs = path.join(/* turbopackIgnore: true */ ROOT, rel);
  if (!existsSync(/* turbopackIgnore: true */ abs)) return;
  for (const e of await readdir(/* turbopackIgnore: true */ abs, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (BLOCKED.test(child)) continue;
    if (e.isDirectory()) await walk(child, out);
    else out.push(child);
  }
}

export async function listFiles(prefix = ""): Promise<string[]> {
  const p = normalize(prefix);
  const out: string[] = [];
  for (const d of DIRS) await walk(d, out);
  for (const f of await readdir(/* turbopackIgnore: true */ ROOT)) if (ROOT_FILES.test(f)) out.push(f);
  for (const f of EXTRA_FILES) if (existsSync(path.join(/* turbopackIgnore: true */ ROOT, f))) out.push(f);
  return out.filter((f) => !p || f === p || f.startsWith(`${p}/`)).sort();
}

export async function readText(p: string, start?: number, end?: number) {
  const rel = normalize(p);
  if (!allowed(rel)) throw new Error(`fora das pastas liberadas: ${p}`);
  const abs = path.join(/* turbopackIgnore: true */ ROOT, rel);
  const s = await stat(/* turbopackIgnore: true */ abs).catch(() => null);
  if (!s?.isFile()) throw new Error(`arquivo não encontrado: ${p}`);
  if (s.size > 1_000_000) throw new Error("arquivo grande demais (>1MB)");
  const lines = (await readFile(/* turbopackIgnore: true */ abs, "utf8")).split(/\r?\n/);
  const from = Math.max(1, start ?? 1);
  const to = Math.min(lines.length, end ?? lines.length);
  return {
    path: rel,
    total_lines: lines.length,
    from,
    to,
    content: lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n"),
  };
}

export async function searchCode(query: string, prefix = "", regex = false, limit = 200) {
  let re: RegExp;
  try {
    re = regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    throw new Error("regex inválida");
  }
  const hits: string[] = [];
  for (const f of await listFiles(prefix)) {
    if (!TEXT.test(f)) continue;
    const lines = (await readFile(path.join(/* turbopackIgnore: true */ ROOT, f), "utf8").catch(() => "")).split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (re.test(lines[i])) hits.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
    }
    if (hits.length >= limit) break;
  }
  return hits;
}
