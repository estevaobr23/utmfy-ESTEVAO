// Carrega .env.local (sem imprimir valores).
import { existsSync, readFileSync } from "node:fs";
export function loadEnv(file = ".env.local") {
  const out = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2];
    }
  }
  return out;
}
export function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}
